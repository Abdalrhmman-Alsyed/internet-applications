import { paginate, Role } from '@app/common';
import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { Prisma, User } from '@prisma-clients/users';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from './prisma.service';

/** Never send hashes or lockout internals outside this service. */
export function toPublicUser(user: User) {
  const { passwordHash, refreshTokenHash, failedLoginAttempts, lockedUntil, ...rest } = user;
  return rest;
}

export interface UpdateMePayload {
  name?: string;
  phone?: string;
  currentPassword?: string;
  newPassword?: string;
}

export interface FindUsersQuery {
  page?: number;
  limit?: number;
  search?: string;
  role?: Role;
}

@Injectable()
export class UsersService implements OnModuleInit {
  private readonly logger = new Logger(UsersService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Seeds the first admin from env; admins can't be created through public registration. */
  async onModuleInit() {
    const email = process.env.ADMIN_EMAIL?.toLowerCase();
    const password = process.env.ADMIN_PASSWORD;
    if (!email || !password) return;
    const exists = await this.prisma.user.findUnique({ where: { email } });
    if (exists) return;
    await this.prisma.user.create({
      data: { email, name: 'Administrator', role: Role.ADMIN, passwordHash: await bcrypt.hash(password, 12) },
    });
    this.logger.log(`Seeded admin account ${email}`);
  }

  async findById(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('User not found');
    return toPublicUser(user);
  }

  async updateMe(userId: string, dto: UpdateMePayload) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    const data: Prisma.UserUpdateInput = { name: dto.name, phone: dto.phone };
    if (dto.newPassword) {
      if (!dto.currentPassword || !(await bcrypt.compare(dto.currentPassword, user.passwordHash))) {
        throw new BadRequestException('Current password is incorrect');
      }
      data.passwordHash = await bcrypt.hash(dto.newPassword, 12);
      data.refreshTokenHash = null; // changing the password signs out other sessions
    }
    return toPublicUser(await this.prisma.user.update({ where: { id: userId }, data }));
  }

  async findAll({ page = 1, limit = 20, search, role }: FindUsersQuery) {
    const where: Prisma.UserWhereInput = {
      role,
      ...(search && {
        OR: [
          { email: { contains: search, mode: 'insensitive' } },
          { name: { contains: search, mode: 'insensitive' } },
        ],
      }),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({ where, skip: (page - 1) * limit, take: limit, orderBy: { createdAt: 'desc' } }),
      this.prisma.user.count({ where }),
    ]);
    return paginate(items.map(toPublicUser), total, page, limit);
  }
}
