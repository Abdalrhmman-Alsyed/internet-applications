import { NOTIFICATIONS_QUEUE, Role } from '@app/common';
import { Controller, Get, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiForbiddenResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { Response } from 'express';
import { Public, Roles } from '../common/decorators';
import { HealthService } from './health.service';

export const RATE_LIMIT = Number(process.env.RATE_LIMIT ?? 300);
export const AUTH_RATE_LIMIT = Number(process.env.AUTH_RATE_LIMIT ?? 20);
const startedAt = new Date();

@ApiTags('Health')
@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Status of the gateway and every service' })
  async check(@Res({ passthrough: true }) res: Response) {
    const services = await this.health.check();
    const allUp = Object.values(services).every((s) => s.status === 'up');
    res.status(allUp ? 200 : 503);
    return { status: allUp ? 'ok' : 'degraded', services, timestamp: new Date().toISOString() };
  }
}

@ApiTags('System')
@ApiBearerAuth()
@SkipThrottle()
@Controller('system')
export class SystemController {
  constructor(private readonly health: HealthService) {}

  @Roles(Role.ADMIN)
  @Get('info')
  @ApiOperation({ summary: '[Admin] Runtime info: services, security config, message queue stats' })
  @ApiForbiddenResponse({ description: 'Not an admin' })
  async info() {
    const [services, queue] = await Promise.all([this.health.check(), this.queueStats()]);
    const mem = process.memoryUsage();
    return {
      gateway: {
        startedAt: startedAt.toISOString(),
        uptimeSeconds: Math.round(process.uptime()),
        nodeVersion: process.version,
        memoryMb: Math.round(mem.rss / 1024 / 1024),
        environment: process.env.NODE_ENV ?? 'development',
      },
      services,
      security: {
        authentication: 'JWT (HS256) access + refresh with rotation',
        accessTokenTtl: process.env.JWT_ACCESS_TTL ?? '15m',
        refreshTokenTtl: process.env.JWT_REFRESH_TTL ?? '7d',
        rateLimitPerMinute: RATE_LIMIT,
        authRateLimitPerMinute: AUTH_RATE_LIMIT,
        maxFailedLogins: 5,
        lockMinutes: 15,
        passwordHashing: 'bcrypt (12 rounds)',
        roles: Object.values(Role),
      },
      queue,
    };
  }

  /** Live stats of the events queue from the RabbitMQ management API (null if unreachable). */
  private async queueStats() {
    const base = process.env.RABBITMQ_MANAGEMENT_URL ?? 'http://localhost:15672';
    const auth = Buffer.from(`${process.env.RABBITMQ_USER ?? 'app'}:${process.env.RABBITMQ_PASSWORD ?? 'app_password'}`).toString('base64');
    try {
      const res = await fetch(`${base}/api/queues/%2F/${NOTIFICATIONS_QUEUE}`, {
        headers: { Authorization: `Basic ${auth}` },
        signal: AbortSignal.timeout(2000),
      });
      if (!res.ok) return null;
      const q = (await res.json()) as {
        messages?: number;
        consumers?: number;
        durable?: boolean;
        message_stats?: { publish?: number; ack?: number; publish_details?: { rate?: number } };
      };
      return {
        name: NOTIFICATIONS_QUEUE,
        durable: q.durable ?? false,
        consumers: q.consumers ?? 0,
        pending: q.messages ?? 0,
        published: q.message_stats?.publish ?? 0,
        acknowledged: q.message_stats?.ack ?? 0,
        publishRatePerSec: q.message_stats?.publish_details?.rate ?? 0,
      };
    } catch {
      return null;
    }
  }
}
