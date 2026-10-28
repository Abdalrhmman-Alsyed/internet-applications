import { AuthUser, ORDERS_SERVICE, PATTERNS, Role, sendRpc } from '@app/common';
import { Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { ApiBearerAuth, ApiForbiddenResponse, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser, Roles } from '../common/decorators';
import { CreateOrderDto, OrdersQueryDto, UpdateOrderStatusDto } from './orders.dto';

@ApiTags('Orders')
@ApiBearerAuth()
@Controller('orders')
export class OrdersController {
  constructor(@Inject(ORDERS_SERVICE) private readonly orders: ClientProxy) {}

  @Roles(Role.CUSTOMER)
  @Post()
  @ApiOperation({ summary: '[Customer] Place an order (stock reserved atomically)' })
  @ApiResponse({ status: 409, description: 'Insufficient stock' })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateOrderDto) {
    return sendRpc(this.orders, PATTERNS.orders.create, { user, data: dto });
  }

  @Get()
  @ApiOperation({ summary: 'List orders: customers get only their own, admins get all' })
  findAll(@CurrentUser() user: AuthUser, @Query() query: OrdersQueryDto) {
    return sendRpc(this.orders, PATTERNS.orders.findAll, { user, query });
  }

  // Declared before ':id' so "stats" isn't parsed as an order id.
  @Roles(Role.ADMIN)
  @Get('stats')
  @ApiOperation({ summary: '[Admin] Dashboard statistics: per status, revenue, last 7 days' })
  @ApiForbiddenResponse({ description: 'Not an admin' })
  stats(@CurrentUser() user: AuthUser) {
    return sendRpc(this.orders, PATTERNS.orders.stats, { user });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Order details with status history (owner or admin)' })
  @ApiForbiddenResponse({ description: "Order belongs to another user" })
  findOne(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return sendRpc(this.orders, PATTERNS.orders.findOne, { user, id });
  }

  @Roles(Role.ADMIN)
  @Patch(':id/status')
  @ApiOperation({ summary: '[Admin] Change order status (PENDING→CONFIRMED→SHIPPED→DELIVERED, or CANCELLED)' })
  @ApiForbiddenResponse({ description: 'Not an admin' })
  updateStatus(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateOrderStatusDto) {
    return sendRpc(this.orders, PATTERNS.orders.updateStatus, { user, id, ...dto });
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @ApiOperation({ summary: 'Cancel an order (customer: own PENDING orders only)' })
  @ApiForbiddenResponse({ description: "Order belongs to another user" })
  cancel(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return sendRpc(this.orders, PATTERNS.orders.cancel, { user, id });
  }
}
