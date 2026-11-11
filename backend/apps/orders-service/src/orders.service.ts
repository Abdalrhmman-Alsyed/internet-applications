import {
  AuthUser,
  CacheService,
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
import { ReplicaPrismaService } from './replica-prisma.service';

const LOW_STOCK_THRESHOLD = Number(process.env.LOW_STOCK_THRESHOLD ?? 5);
const STATS_KEY = 'orders:stats';

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
    private readonly replica: ReplicaPrismaService,
    @Inject(PRODUCTS_SERVICE) private readonly products: ClientProxy,
    private readonly inventory: InventoryClient,
    private readonly cache: CacheService,
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

    // Read-your-writes: this customer's next reads come from the primary for a few seconds.
    await Promise.all([this.cache.del(STATS_KEY), this.cache.markFresh(`user:${user.id}`), this.cache.markFresh('orders')]);
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

  /**
   * Reads go to the read replica, except right after this user wrote something
   * (placed, cancelled or changed an order): then the primary, so they see it.
   */
  private async reader(userId: string) {
    return (await this.cache.isFresh(`user:${userId}`)) ? this.prisma : this.replica;
  }

  /** Customers only ever see their own orders; admins see all and can filter. */
  async findAll(user: AuthUser, q: FindOrdersQuery) {
    const page = q.page ?? 1;
    const limit = q.limit ?? 20;
    const where: Prisma.OrderWhereInput = {
      status: q.status,
      userId: user.role === Role.ADMIN ? q.userId : user.id,
    };
    const db = await this.reader(user.id);
    const [items, total] = await db.$transaction([
      db.order.findMany({ where, include: orderInclude, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit }),
      db.order.count({ where }),
    ]);
    return paginate(items.map(toDto), total, page, limit);
  }

  async findOne(user: AuthUser, id: string) {
    return toDto(await this.getAuthorized(user, id, await this.reader(user.id)));
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

  /**
   * Dashboard figures: counts per status, revenue (excluding cancelled) and the last 7 days.
   * Summing 300k orders can't be made fast with an index (every row is read), so the
   * result is cached; any new order or status change deletes it.
   */
  async stats(user: AuthUser) {
    if (user.role !== Role.ADMIN) throw new ForbiddenException('Only admins can view order statistics');
    return this.cache.getOrSet(STATS_KEY, 30, () => this.computeStats());
  }

  private async computeStats() {
    // Right after any order write the replica may not have it yet: use the primary.
    const db = (await this.cache.isFresh('orders')) ? this.prisma : this.replica;
    const since = new Date();
    since.setHours(0, 0, 0, 0);
    since.setDate(since.getDate() - 6);

    // Both aggregations run inside Postgres: 5 + 7 rows come back, not thousands of orders.
    // Count and revenue per status in ONE pass (was two scans of the whole table).
    const [grouped, daily] = await Promise.all([
      db.order.groupBy({ by: ['status'], _count: { _all: true }, _sum: { total: true } }),
      // Uses the createdAt index instead of scanning every order.
      db.$queryRaw<{ day: string; orders: number; revenue: number }[]>`
        SELECT to_char(date_trunc('day', "createdAt"), 'YYYY-MM-DD') AS day,
               count(*)::int AS orders,
               coalesce(sum(total) FILTER (WHERE status <> 'CANCELLED'), 0)::float AS revenue
        FROM orders WHERE "createdAt" >= ${since}
        GROUP BY 1`,
    ]);

    const byStatus = Object.fromEntries(Object.values(OrderStatus).map((s) => [s, 0])) as Record<OrderStatus, number>;
    let revenue = 0;
    for (const g of grouped) {
      byStatus[g.status as OrderStatus] = g._count._all;
      if (g.status !== OrderStatus.CANCELLED) revenue += g._sum.total?.toNumber() ?? 0;
    }

    const last7Days = Array.from({ length: 7 }, (_, i) => {
      const day = new Date(since);
      day.setDate(since.getDate() + i);
      const date = day.toISOString().slice(0, 10);
      const found = daily.find((d) => d.day === date);
      return { date, orders: found?.orders ?? 0, revenue: Math.round((found?.revenue ?? 0) * 100) / 100 };
    });

    return {
      totalOrders: Object.values(byStatus).reduce((a, b) => a + b, 0),
      revenue: Math.round(revenue * 100) / 100,
      byStatus,
      last7Days,
    };
  }




  /**فحص ملكية الطلب 
   *  Loads an order and enforces ownership: a customer touching someone else's order gets 403. */
  private async getAuthorized(user: AuthUser, id: string, db: PrismaService | ReplicaPrismaService = this.prisma) {
    let order = await db.order.findUnique({ where: { id }, include: orderInclude });
    // Not on the replica may just mean "not replicated yet" (e.g. an admin opening a
    // brand-new order from its notification): ask the primary before saying 404.
    if (!order && db !== this.prisma) order = await this.prisma.order.findUnique({ where: { id }, include: orderInclude });
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
    // The owner and whoever changed it must see the new status at once (read-your-writes).
    await Promise.all([
      this.cache.del(STATS_KEY),
      this.cache.markFresh(`user:${order.userId}`),
      this.cache.markFresh(`user:${changedBy}`),
      this.cache.markFresh('orders'),
    ]);

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
