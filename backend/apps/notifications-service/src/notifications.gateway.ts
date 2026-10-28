import { JwtPayload, Role } from '@app/common';
import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { OnGatewayConnection, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';

export const ADMINS_ROOM = 'admins';
export const userRoom = (userId: string) => `user:${userId}`;

/**
 * Real-time channel. Clients connect with their access token:
 *   io('http://localhost:3004', { auth: { token: '<accessToken>' } })
 * and receive "notification" events for themselves (and for admins, if admin).
 */
@WebSocketGateway({
  cors: { origin: (process.env.CORS_ORIGINS ?? 'http://localhost:3001').split(','), credentials: true },
})
export class NotificationsGateway implements OnGatewayConnection {
  private readonly logger = new Logger(NotificationsGateway.name);
  @WebSocketServer() server!: Server;

  constructor(private readonly jwt: JwtService) {}

  async handleConnection(client: Socket) {
    const raw = (client.handshake.auth?.token as string | undefined) ?? client.handshake.headers.authorization;
    const token = raw?.replace(/^Bearer\s+/i, '');
    try {
      const payload = await this.jwt.verifyAsync<JwtPayload>(token ?? '', { secret: process.env.JWT_ACCESS_SECRET });
      await client.join(userRoom(payload.sub));
      if (payload.role === Role.ADMIN) await client.join(ADMINS_ROOM);
      client.data.user = payload;
    } catch {
      client.emit('error', { statusCode: 401, message: 'Unauthorized' });
      client.disconnect(true);
    }
  }

  emitToUser(userId: string, notification: unknown) {
    this.server.to(userRoom(userId)).emit('notification', notification);
  }

  emitToAdmins(notification: unknown) {
    this.server.to(ADMINS_ROOM).emit('notification', notification);
  }
}
