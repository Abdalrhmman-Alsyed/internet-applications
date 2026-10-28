import {
  AuthUser,
  EVENTS,
  EVENTS_BUS,
  OrderCreatedEvent,
  OrderStatus,
  OrderStatusChangedEvent,
  paginate,
  PATTERNS,
  PRODUCTS_SERVICE,
  Role,
  sendRpc,
} from '@app/common';
import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { Prisma } from '@prisma-clients/orders';
import { PrismaService } from './prisma.service';

/** Allowed status transitions; DELIVERED and CANCELLED are final. */
const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  [OrderStatus.PENDING]: [OrderStatus.CONFIRMED, OrderStatus.CANCELLED],
  [OrderStatus.CONFIRMED]: [OrderStatus.SHIPPED, OrderStatus.CANCELLED],
  [OrderStatus.SHIPPED]: [OrderStatus.DELIVERED],
  [OrderStatus.DELIVERED]: [],
  [OrderStatus.CANCELLED]: [],
};

const orderInclude = {
  items: true,
  history: { orderBy: { createdAt: 'asc' } },
} satisfies Prisma.OrderInclude;

type OrderWithRelations = Prisma.OrderGetPayload<{ include: typeof orderInclude }>;

const toDto = (o: OrderWithRelations) => ({
  ...o,
  total: o.total.toNumber(),
  items: o.items.map((i) => ({ ...i, unitPrice: i.unitPrice.toNumber(), subtotal: i.unitPrice.toNumber() * i.quantity })),
});

interface ReservedItem {
  productId: string;
  name: string;
  unitPrice: number;
  quantity: number;
}

export interface CreateOrderPayload {
  items: { productId: string; quantity: number }[];
  shippingAddress: string;
  note?: string;
}

export interface FindOrdersQuery {
  page?: number;
  limit?: number;
  status?: OrderStatus;
  userId?: string;
}

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(PRODUCTS_SERVICE) private readonly products: ClientProxy,
    @Inject(EVENTS_BUS) private readonly events: ClientProxy,
  ) {}

  async create(user: AuthUser, dto: CreateOrderPayload) {
    if (user.role !== Role.CUSTOMER) throw new ForbiddenException('Only customers can place orders');

    // Prices and names come from products-service, never from the client.
    const reserved = await sendRpc<ReservedItem[]>(this.products, PATTERNS.products.reserveStock, { items: dto.items });
    const total = reserved.reduce((sum, i) => sum + i.unitPrice * i.quantity, 0);

    let order: OrderWithRelations;
    try {
      order = await this.prisma.order.create({
        data: {
          userId: user.id,
          total,
          shippingAddress: dto.shippingAddress,
          note: dto.note,
          items: {
            create: reserved.map((i) => ({
              productId: i.productId,
              productName: i.name,
              unitPrice: i.unitPrice,
              quantity: i.quantity,
            })),
          },
          history: { create: { status: OrderStatus.PENDING, changedBy: user.id } },
        },
        include: orderInclude,
      });
    } catch (err) {
      // Compensation: give the stock back if the order couldn't be saved.
      await sendRpc(this.products, PATTERNS.products.releaseStock, { items: dto.items }).catch((e) =>
        this.logger.error(`Failed to release stock: ${e}`),
      );
      throw err;
    }

    this.events.emit<void, OrderCreatedEvent>(EVENTS.orderCreated, {
      orderId: order.id,
      userId: user.id,
      total,
      itemsCount: reserved.reduce((n, i) => n + i.quantity, 0),
    });
    return toDto(order);
  }

  /** Customers only ever see their own orders; admins see all and can filter. */
  async findAll(user: AuthUser, q: FindOrdersQuery) {
    const page = q.page ?? 1;
    const limit = q.limit ?? 20;
    const where: Prisma.OrderWhereInput = {
      status: q.status,
      userId: user.role === Role.ADMIN ? q.userId : user.id,
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.order.findMany({ where, include: orderInclude, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit }),
      this.prisma.order.count({ where }),
    ]);
    return paginate(items.map(toDto), total, page, limit);
  }

  async findOne(user: AuthUser, id: string) {
    return toDto(await this.getAuthorized(user, id));
  }

  async updateStatus(user: AuthUser, id: string, status: OrderStatus, note?: string) {
    if (user.role !== Role.ADMIN) throw new ForbiddenException('Only admins can change order status');
    const order = await this.getAuthorized(user, id);
    return this.transition(order, status, user.id, note);
  }

  /** A customer may cancel their own order while it is still PENDING. */
  async cancel(user: AuthUser, id: string) {
    const order = await this.getAuthorized(user, id);
    if (user.role !== Role.ADMIN && order.status !== OrderStatus.PENDING) {
      throw new BadRequestException('Only pending orders can be cancelled');
    }
    return this.transition(order, OrderStatus.CANCELLED, user.id, 'Cancelled by customer');
  }

  /** Dashboard figures: counts per status, revenue (excluding cancelled) and the last 7 days. */
  async stats(user: AuthUser) {
    if (user.role !== Role.ADMIN) throw new ForbiddenException('Only admins can view order statistics');
    const since = new Date();
    since.setHours(0, 0, 0, 0);
    since.setDate(since.getDate() - 6);

    const [grouped, revenue, recent] = await Promise.all([
      this.prisma.order.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.order.aggregate({ where: { status: { not: OrderStatus.CANCELLED } }, _sum: { total: true } }),
      this.prisma.order.findMany({ where: { createdAt: { gte: since } }, select: { createdAt: true, total: true, status: true } }),
    ]);

    const byStatus = Object.fromEntries(Object.values(OrderStatus).map((s) => [s, 0])) as Record<OrderStatus, number>;
    for (const g of grouped) byStatus[g.status as OrderStatus] = g._count._all;

    const last7Days = Array.from({ length: 7 }, (_, i) => {
      const day = new Date(since);
      day.setDate(since.getDate() + i);
      return { date: day.toISOString().slice(0, 10), orders: 0, revenue: 0 };
    });
    for (const o of recent) {
      const bucket = last7Days.find((d) => d.date === o.createdAt.toISOString().slice(0, 10));
      if (!bucket) continue;
      bucket.orders += 1;
      if (o.status !== OrderStatus.CANCELLED) bucket.revenue += o.total.toNumber();
    }

    return {
      totalOrders: Object.values(byStatus).reduce((a, b) => a + b, 0),
      revenue: revenue._sum.total?.toNumber() ?? 0,
      byStatus,
      last7Days,
    };
  }

  /** Loads an order and enforces ownership: a customer touching someone else's order gets 403. */
  private async getAuthorized(user: AuthUser, id: string) {
    const order = await this.prisma.order.findUnique({ where: { id }, include: orderInclude });
    if (!order) throw new NotFoundException('Order not found');
    if (user.role !== Role.ADMIN && order.userId !== user.id) {
      this.logger.warn(`User ${user.id} tried to access order ${id} owned by ${order.userId}`);
      throw new ForbiddenException('You do not have access to this order');
    }
    return order;
  }

  private async transition(order: OrderWithRelations, to: OrderStatus, changedBy: string, note?: string) {
    const from = order.status as OrderStatus;
    if (!TRANSITIONS[from].includes(to)) {
      throw new BadRequestException(`Cannot change order status from ${from} to ${to}`);
    }
    // Conditional update guards against two concurrent transitions from the same state.
    const { count } = await this.prisma.order.updateMany({ where: { id: order.id, status: from }, data: { status: to } });
    if (count === 0) throw new BadRequestException('Order status was changed by another request, please retry');
    await this.prisma.orderStatusHistory.create({ data: { orderId: order.id, status: to, changedBy, note } });

    if (to === OrderStatus.CANCELLED) {
      await sendRpc(this.products, PATTERNS.products.releaseStock, {
        items: order.items.map((i) => ({ productId: i.productId, quantity: i.quantity })),
      });
    }
    this.events.emit<void, OrderStatusChangedEvent>(EVENTS.orderStatusChanged, {
      orderId: order.id,
      userId: order.userId,
      from,
      to,
    });
    return toDto((await this.prisma.order.findUnique({ where: { id: order.id }, include: orderInclude }))!);
  }
}
