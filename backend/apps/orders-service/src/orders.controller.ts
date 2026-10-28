import { AuthUser, OrderStatus, PATTERNS } from '@app/common';
import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { CreateOrderPayload, FindOrdersQuery, OrdersService } from './orders.service';

@Controller()
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @MessagePattern(PATTERNS.health)
  health() {
    return { service: 'orders', status: 'ok' };
  }

  @MessagePattern(PATTERNS.orders.create)
  create(@Payload() { user, data }: { user: AuthUser; data: CreateOrderPayload }) {
    return this.orders.create(user, data);
  }

  @MessagePattern(PATTERNS.orders.findAll)
  findAll(@Payload() { user, query }: { user: AuthUser; query: FindOrdersQuery }) {
    return this.orders.findAll(user, query);
  }

  @MessagePattern(PATTERNS.orders.findOne)
  findOne(@Payload() { user, id }: { user: AuthUser; id: string }) {
    return this.orders.findOne(user, id);
  }

  @MessagePattern(PATTERNS.orders.updateStatus)
  updateStatus(@Payload() { user, id, status, note }: { user: AuthUser; id: string; status: OrderStatus; note?: string }) {
    return this.orders.updateStatus(user, id, status, note);
  }

  @MessagePattern(PATTERNS.orders.cancel)
  cancel(@Payload() { user, id }: { user: AuthUser; id: string }) {
    return this.orders.cancel(user, id);
  }
}
