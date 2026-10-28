import { EVENTS, EVENTS_BUS, JwtPayload, Role, UserRegisteredEvent } from '@app/common';
import {
  ConflictException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService, JwtSignOptions } from '@nestjs/jwt';
import { ClientProxy } from '@nestjs/microservices';
import * as bcrypt from 'bcryptjs';
import { createHash, randomUUID } from 'crypto';
import { PrismaService } from './prisma.service';
import { toPublicUser } from './users.service';

const MAX_FAILED_LOGINS = 5;
const LOCK_MINUTES = 15;
const BCRYPT_ROUNDS = 12;

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

export interface RegisterPayload {
  email: string;
  password: string;
  name: string;
  phone?: string;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    @Inject(EVENTS_BUS) private readonly events: ClientProxy,
  ) {}

  async register(dto: RegisterPayload) {
    const email = dto.email.toLowerCase().trim();
    if (await this.prisma.user.findUnique({ where: { email } })) {
      throw new ConflictException('Email is already registered');
    }
    // Public registration always creates customers; admins are seeded.
    const user = await this.prisma.user.create({
      data: {
        email,
        name: dto.name,
        phone: dto.phone,
        passwordHash: await bcrypt.hash(dto.password, BCRYPT_ROUNDS),
        role: Role.CUSTOMER,
      },
    });
    this.events.emit<void, UserRegisteredEvent>(EVENTS.userRegistered, {
      userId: user.id,
      name: user.name,
      email: user.email,
    });
    return { user: toPublicUser(user), ...(await this.issueTokens(user)) };
  }

  async login(emailInput: string, password: string) {
    const email = emailInput.toLowerCase().trim();
    const user = await this.prisma.user.findUnique({ where: { email } });
    // Same message for unknown email and wrong password: don't reveal which accounts exist.
    const invalid = new UnauthorizedException('Invalid email or password');
    if (!user) throw invalid;

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      const minutes = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60000);
      throw new HttpException(
        { statusCode: HttpStatus.LOCKED, error: 'Locked', message: `Account locked after too many failed attempts. Try again in ${minutes} minute(s)` },
        HttpStatus.LOCKED,
      );
    }

    if (!(await bcrypt.compare(password, user.passwordHash))) {
      const attempts = user.failedLoginAttempts + 1;
      const lock = attempts >= MAX_FAILED_LOGINS;
      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          failedLoginAttempts: lock ? 0 : attempts,
          lockedUntil: lock ? new Date(Date.now() + LOCK_MINUTES * 60000) : null,
        },
      });
      if (lock) this.logger.warn(`Account ${user.email} locked for ${LOCK_MINUTES} minutes`);
      throw invalid;
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { failedLoginAttempts: 0, lockedUntil: null },
    });
    return { user: toPublicUser(user), ...(await this.issueTokens(user)) };
  }

  /** Refresh-token rotation: each refresh token can be used exactly once. */
  async refresh(refreshToken: string) {
    let payload: JwtPayload;
    try {
      payload = await this.jwt.verifyAsync<JwtPayload>(refreshToken, {
        secret: process.env.JWT_REFRESH_SECRET,
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }
    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || user.refreshTokenHash !== sha256(refreshToken)) {
      // Token reuse after rotation (or after logout) → revoke the session entirely.
      if (user) await this.prisma.user.update({ where: { id: user.id }, data: { refreshTokenHash: null } });
      throw new UnauthorizedException('Refresh token has been revoked');
    }
    return this.issueTokens(user);
  }

  async logout(userId: string) {
    await this.prisma.user.updateMany({ where: { id: userId }, data: { refreshTokenHash: null } });
    return { success: true };
  }

  private async issueTokens(user: { id: string; email: string; role: string }) {
    const payload: JwtPayload = { sub: user.id, email: user.email, role: user.role as Role };
    const accessToken = await this.jwt.signAsync(payload, {
      secret: process.env.JWT_ACCESS_SECRET,
      expiresIn: (process.env.JWT_ACCESS_TTL ?? '15m') as JwtSignOptions['expiresIn'],
    });
    const refreshToken = await this.jwt.signAsync(payload, {
      secret: process.env.JWT_REFRESH_SECRET,
      expiresIn: (process.env.JWT_REFRESH_TTL ?? '7d') as JwtSignOptions['expiresIn'],
      jwtid: randomUUID(),
    });
    await this.prisma.user.update({
      where: { id: user.id },
      data: { refreshTokenHash: sha256(refreshToken) },
    });
    return { accessToken, refreshToken, tokenType: 'Bearer' };
  }
}
