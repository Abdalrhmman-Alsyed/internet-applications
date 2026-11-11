import {
  AuthUser,
  EVENTS,
  EVENTS_BUS,
  InventoryClient,
  InventoryException,
  OrderCreatedEvent,
  OrderStatus,
  OrderStatusChangedEvent,
  paginate,
  PATTERNS,
  PRODUCTS_SERVICE,
  ProductLowStockEvent,
  Role,
  sendRpc,
  StockItem,
} from '@app/common';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { Prisma } from '@prisma-clients/orders';
import { randomUUID } from 'crypto';
import { PrismaService } from './prisma.service';

const LOW_STOCK_THRESHOLD = Number(process.env.LOW_STOCK_THRESHOLD ?? 5);

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

interface CatalogItem {
  productId: string;
  name: string;
  unitPrice: number;
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
    private readonly inventory: InventoryClient,
    @Inject(EVENTS_BUS) private readonly events: ClientProxy,
  ) {}

  /**
   * 1. products-service (TCP): names and current prices, never from the client.
   * 2. inventory-service (gRPC): reserve every item at once, all or nothing.
   * 3. Save the order. If that fails, release the reservation (compensation).
   */
  async create(user: AuthUser, dto: CreateOrderPayload) {
    if (user.role !== Role.CUSTOMER) throw new ForbiddenException('Only customers can place orders');

    const items = mergeItems(dto.items);
    const catalog = await sendRpc<CatalogItem[]>(this.products, PATTERNS.products.forOrder, {
      ids: items.map((i) => i.productId),
    });
    const byId = new Map(catalog.map((c) => [c.productId, c]));
    const lines = items.map((i) => ({ ...byId.get(i.productId)!, quantity: i.quantity }));
    const total = lines.reduce((sum, l) => sum + l.unitPrice * l.quantity, 0);

    // The order id doubles as the reservation id, so a cancellation releases exactly this order.
    const orderId = randomUUID();
    const remaining = await this.reserve(orderId, items, byId);

    let order: OrderWithRelations;
    try {
      order = await this.prisma.order.create({
        data: {
          id: orderId,
          userId: user.id,
          total,
          shippingAddress: dto.shippingAddress,
          note: dto.note,
          items: {
            create: lines.map((l) => ({
              productId: l.productId,
              productName: l.name,
              unitPrice: l.unitPrice,
              quantity: l.quantity,
            })),
          },
          history: { create: { status: OrderStatus.PENDING, changedBy: user.id } },
        },
        include: orderInclude,
      });
    } catch (err) {
      this.logger.error(`Order ${orderId} could not be saved, releasing its stock: ${err}`);
      await this.releaseQuietly(orderId);
      throw err;
    }

    this.events.emit<void, OrderCreatedEvent>(EVENTS.orderCreated, {
      orderId: order.id,
      userId: user.id,
      total,
      itemsCount: lines.reduce((n, l) => n + l.quantity, 0),
    });
    for (const r of remaining.filter((r) => r.quantity <= LOW_STOCK_THRESHOLD)) {
      this.events.emit<void, ProductLowStockEvent>(EVENTS.productLowStock, {
        productId: r.productId,
        name: byId.get(r.productId)?.name ?? r.productId,
        stock: r.quantity,
      });
    }
    return toDto(order);
  }

  /** Reserves over gRPC and turns inventory failures into messages a customer understands. */
  private async reserve(orderId: string, items: StockItem[], byId: Map<string, CatalogItem>) {
    try {
      return await this.inventory.reserve(orderId, items);
    } catch (err) {
      if (!(err instanceof InventoryException)) throw err;
      if (err.getStatus() === HttpStatus.CONFLICT && err.productId) {
        const name = byId.get(err.productId)?.name ?? 'a product';
        throw new ConflictException(`Insufficient stock for "${name}" (only ${err.available ?? 0} left)`);
      }
      if (err.getStatus() >= 500) {
        // We gave up waiting, but inventory may still have reserved. Releasing is
        // idempotent and also blocks a late reservation with this id, so nothing leaks.
        // It runs in the background: the customer gets the answer now, not after more waiting.
        void this.releaseQuietly(orderId);
      }
      throw err;
    }
  }

  /** Releases a reservation, retrying with backoff (1 s, 2 s, 4 s, 8 s) if inventory is unreachable. */
  private async releaseQuietly(reservationId: string, attempt = 1): Promise<void> {
    try {
      await this.inventory.release(reservationId);
    } catch (e) {
      if (attempt >= 5) {
        this.logger.error(`Stock of ${reservationId} not released after ${attempt} attempts: ${(e as Error).message}`);
        return;
      }
      setTimeout(() => void this.releaseQuietly(reservationId, attempt + 1), 1000 * 2 ** (attempt - 1));
    }
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




  /**فحص ملكية الطلب 
   *  Loads an order and enforces ownership: a customer touching someone else's order gets 403. */
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
      await this.releaseQuietly(order.id);
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

/** The same product twice in one order counts as one line. */
function mergeItems(items: StockItem[]): StockItem[] {
  const merged = new Map<string, number>();
  for (const { productId, quantity } of items) merged.set(productId, (merged.get(productId) ?? 0) + quantity);
  return [...merged].map(([productId, quantity]) => ({ productId, quantity }));
}
