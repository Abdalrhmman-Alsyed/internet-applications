import { AuthUser, paginate, Role } from '@app/common';
import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma-clients/notifications';
import { NotificationsGateway } from './notifications.gateway';
import { PrismaService } from './prisma.service';

interface NewNotification {
  type: string;
  title: string;
  body: string;
  data?: Prisma.InputJsonValue;
}

@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: NotificationsGateway,
  ) {}

  async notifyUser(userId: string, n: NewNotification) {
    const saved = await this.prisma.notification.create({ data: { ...n, audience: 'USER', userId } });
    this.gateway.emitToUser(userId, saved);
    return saved;
  }

  async notifyAdmins(n: NewNotification) {
    const saved = await this.prisma.notification.create({ data: { ...n, audience: 'ADMINS' } });
    this.gateway.emitToAdmins(saved);
    return saved;
  }

  /** What a caller may see: their own notifications, plus admin broadcasts if they are an admin. */
  private visibleTo(user: AuthUser): Prisma.NotificationWhereInput {
    return user.role === Role.ADMIN
      ? { OR: [{ userId: user.id }, { audience: 'ADMINS' }] }
      : { userId: user.id, audience: 'USER' };
  }

  async findAll(user: AuthUser, { page = 1, limit = 20, unreadOnly = false }: { page?: number; limit?: number; unreadOnly?: boolean }) {
    const where: Prisma.NotificationWhereInput = { AND: [this.visibleTo(user), unreadOnly ? { readAt: null } : {}] };
    const [items, total, unread] = await this.prisma.$transaction([
      this.prisma.notification.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit }),
      this.prisma.notification.count({ where }),
      this.prisma.notification.count({ where: { AND: [this.visibleTo(user), { readAt: null }] } }),
    ]);
    return { ...paginate(items, total, page, limit), unread };
  }

  async markRead(user: AuthUser, id: string) {
    const n = await this.prisma.notification.findUnique({ where: { id } });
    if (!n) throw new NotFoundException('Notification not found');
    const allowed = n.audience === 'ADMINS' ? user.role === Role.ADMIN : n.userId === user.id;
    if (!allowed) throw new ForbiddenException('You do not have access to this notification');
    return this.prisma.notification.update({ where: { id }, data: { readAt: n.readAt ?? new Date() } });
  }

  async markAllRead(user: AuthUser) {
    const { count } = await this.prisma.notification.updateMany({
      where: { AND: [this.visibleTo(user), { readAt: null }] },
      data: { readAt: new Date() },
    });
    return { updated: count };
  }
}
