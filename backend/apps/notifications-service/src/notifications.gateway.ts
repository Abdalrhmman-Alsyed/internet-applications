import { AuthUser, JwtPayload, ORDERS_SERVICE, PATTERNS, Role, sendRpc } from '@app/common';
import { HttpException, Inject, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ClientProxy } from '@nestjs/microservices';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { hostname } from 'node:os';

export const ADMINS_ROOM = 'admins';
export const userRoom = (userId: string) => `user:${userId}`;
/** Requirement 4 channels */
export const ADMIN_ORDERS_CHANNEL = 'channel:admin.orders';
export const orderChannel = (orderId: string) => `channel:order:${orderId}`;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type SubscribeRequest = { channel: 'admin.orders' } | { channel: 'order'; orderId: string };
type SubscribeAnswer = { ok: true; channel: string } | { ok: false; status: number; message: string };

/**
 * Real-time channel (Socket.IO through the public load balancer).
 *
 * 1. Identity on connect: the access token is verified; a bad token is disconnected.
 *    Every user is placed in their own room (personal notifications), admins also in "admins".
 * 2. Requirement 4 channels, joined explicitly with
 *      socket.emit('subscribe', { channel: 'order', orderId }, answer => …)   // order tracking
 *      socket.emit('subscribe', { channel: 'admin.orders' }, answer => …)     // admin dashboard
 *    Each subscription re-checks the token and the permission BEFORE joining:
 *    an order channel only for its owner (or an admin), the admin channel only for admins.
 */
@WebSocketGateway({
  cors: { origin: (process.env.CORS_ORIGINS ?? 'http://localhost:3001').split(','), credentials: true },
})
export class NotificationsGateway implements OnGatewayConnection, OnGatewayInit {
  private readonly logger = new Logger(NotificationsGateway.name);
  @WebSocketServer() server!: Server;

  constructor(
    private readonly jwt: JwtService,
    @Inject(ORDERS_SERVICE) private readonly orders: ClientProxy,
  ) {}

  afterInit(server: Server) {
    const instance = hostname();
    server.engine.on('initial_headers', (headers) => {
      headers['X-Served-By'] = instance;
    });
  }

  async handleConnection(client: Socket) {
    try {
      const payload = await this.verify(client);
      await client.join(userRoom(payload.sub));
      if (payload.role === Role.ADMIN) await client.join(ADMINS_ROOM);
      client.data.user = payload;
    } catch {
      client.emit('error', { statusCode: 401, message: 'Unauthorized' });
      client.disconnect(true);
    }
  }

  @SubscribeMessage('subscribe')
  async subscribe(@ConnectedSocket() client: Socket, @MessageBody() req: SubscribeRequest): Promise<SubscribeAnswer> {
    // 1. Identity, checked again: the token may have expired since the socket connected.
    let user: AuthUser;
    try {
      const p = await this.verify(client);
      user = { id: p.sub, email: p.email, role: p.role };
    } catch {
      return { ok: false, status: 401, message: 'Your session has expired, sign in again' };
    }

    // 2. Permission, per channel.
    if (req?.channel === 'admin.orders') {
      if (user.role !== Role.ADMIN) {
        this.logger.warn(`User ${user.id} (${user.role}) refused on the admin channel`);
        return { ok: false, status: 403, message: 'Only admins can subscribe to the admin channel' };
      }
      await client.join(ADMIN_ORDERS_CHANNEL);
      return { ok: true, channel: 'admin.orders' };
    }

    if (req?.channel === 'order') {
      if (!UUID.test(req.orderId ?? '')) return { ok: false, status: 400, message: 'orderId must be a UUID' };
      try {
        // orders-service applies the same ownership rule as GET /orders/:id (owner or admin).
        await sendRpc(this.orders, PATTERNS.orders.findOne, { user, id: req.orderId }, 3000);
      } catch (err) {
        const status = err instanceof HttpException ? err.getStatus() : 503;
        if (status === 403) this.logger.warn(`User ${user.id} refused on the channel of order ${req.orderId}`);
        return { ok: false, status, message: status === 403 ? 'You can only follow your own orders' : (err as Error).message };
      }
      await client.join(orderChannel(req.orderId));
      return { ok: true, channel: `order:${req.orderId}` };
    }

    return { ok: false, status: 400, message: 'Unknown channel' };
  }

  @SubscribeMessage('unsubscribe')
  async unsubscribe(@ConnectedSocket() client: Socket, @MessageBody() req: SubscribeRequest) {
    if (req?.channel === 'admin.orders') await client.leave(ADMIN_ORDERS_CHANNEL);
    if (req?.channel === 'order' && UUID.test(req.orderId ?? '')) await client.leave(orderChannel(req.orderId));
    return { ok: true };
  }

  // ─── Pushes ───
  emitToUser(userId: string, notification: unknown) {
    this.server.to(userRoom(userId)).emit('notification', notification);
  }

  emitToAdmins(notification: unknown) {
    this.server.to(ADMINS_ROOM).emit('notification', notification);
  }

  /** A new order, to everyone on the admin channel. */
  emitNewOrder(order: unknown) {
    this.server.to(ADMIN_ORDERS_CHANNEL).emit('order.created', order);
  }

  /** A status change, to whoever follows that order (and to the admin channel). */
  emitOrderStatus(orderId: string, change: unknown) {
    this.server.to(orderChannel(orderId)).to(ADMIN_ORDERS_CHANNEL).emit('order.status', change);
  }

  private async verify(client: Socket): Promise<JwtPayload> {
    const raw = (client.handshake.auth?.token as string | undefined) ?? client.handshake.headers.authorization;
    const token = raw?.replace(/^Bearer\s+/i, '');
    return this.jwt.verifyAsync<JwtPayload>(token ?? '', { secret: process.env.JWT_ACCESS_SECRET });
  }
}
