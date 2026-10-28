import {
  AuthUser,
  EVENTS,
  OrderCreatedEvent,
  OrderStatusChangedEvent,
  PATTERNS,
  ProductLowStockEvent,
  UserRegisteredEvent,
} from '@app/common';
import { Controller, Logger } from '@nestjs/common';
import { Ctx, EventPattern, MessagePattern, Payload, RmqContext } from '@nestjs/microservices';
import { NotificationsService } from './notifications.service';

const STATUS_TEXT: Record<string, string> = {
  CONFIRMED: 'has been confirmed',
  SHIPPED: 'has been shipped',
  DELIVERED: 'has been delivered',
  CANCELLED: 'has been cancelled',
};

@Controller()
export class NotificationsController {
  private readonly logger = new Logger(NotificationsController.name);

  constructor(private readonly notifications: NotificationsService) {}

  // ─── Requests from the gateway (TCP) ───
  @MessagePattern(PATTERNS.health)
  health() {
    return { service: 'notifications', status: 'ok' };
  }

  @MessagePattern(PATTERNS.notifications.findAll)
  findAll(@Payload() { user, query }: { user: AuthUser; query: { page?: number; limit?: number; unreadOnly?: boolean } }) {
    return this.notifications.findAll(user, query);
  }

  @MessagePattern(PATTERNS.notifications.markRead)
  markRead(@Payload() { user, id }: { user: AuthUser; id: string }) {
    return this.notifications.markRead(user, id);
  }

  @MessagePattern(PATTERNS.notifications.markAllRead)
  markAllRead(@Payload() { user }: { user: AuthUser }) {
    return this.notifications.markAllRead(user);
  }

  // ─── Domain events (RabbitMQ, async) ───
  @EventPattern(EVENTS.userRegistered)
  onUserRegistered(@Payload() e: UserRegisteredEvent, @Ctx() ctx: RmqContext) {
    return this.handle(ctx, () =>
      this.notifications.notifyUser(e.userId, {
        type: EVENTS.userRegistered,
        title: 'Welcome!',
        body: `Hi ${e.name}, your account is ready.`,
      }),
    );
  }

  @EventPattern(EVENTS.orderCreated)
  onOrderCreated(@Payload() e: OrderCreatedEvent, @Ctx() ctx: RmqContext) {
    return this.handle(ctx, async () => {
      await this.notifications.notifyUser(e.userId, {
        type: EVENTS.orderCreated,
        title: 'Order received',
        body: `Your order #${e.orderId.slice(0, 8)} (${e.itemsCount} item(s), total ${e.total.toFixed(2)}) was placed.`,
        data: { orderId: e.orderId },
      });
      await this.notifications.notifyAdmins({
        type: EVENTS.orderCreated,
        title: 'New order',
        body: `Order #${e.orderId.slice(0, 8)} placed, total ${e.total.toFixed(2)}.`,
        data: { orderId: e.orderId, userId: e.userId },
      });
    });
  }

  @EventPattern(EVENTS.orderStatusChanged)
  onOrderStatusChanged(@Payload() e: OrderStatusChangedEvent, @Ctx() ctx: RmqContext) {
    return this.handle(ctx, () =>
      this.notifications.notifyUser(e.userId, {
        type: EVENTS.orderStatusChanged,
        title: 'Order update',
        body: `Your order #${e.orderId.slice(0, 8)} ${STATUS_TEXT[e.to] ?? `is now ${e.to}`}.`,
        data: { orderId: e.orderId, from: e.from, to: e.to },
      }),
    );
  }

  @EventPattern(EVENTS.productLowStock)
  onLowStock(@Payload() e: ProductLowStockEvent, @Ctx() ctx: RmqContext) {
    return this.handle(ctx, () =>
      this.notifications.notifyAdmins({
        type: EVENTS.productLowStock,
        title: e.stock === 0 ? 'Out of stock' : 'Low stock',
        body: `"${e.name}" has ${e.stock} unit(s) left.`,
        data: { productId: e.productId, stock: e.stock },
      }),
    );
  }

  /** Manual ack: a message is removed from the queue only after it was processed. */
  private async handle(ctx: RmqContext, work: () => Promise<unknown>) {
    const channel = ctx.getChannelRef();
    const message = ctx.getMessage();
    try {
      await work();
      channel.ack(message);
    } catch (err) {
      this.logger.error(`Failed to process ${ctx.getPattern()}: ${err}`);
      channel.nack(message, false, false);
    }
  }
}
