import {
  NOTIFICATIONS_SERVICE,
  ORDERS_SERVICE,
  PATTERNS,
  PRODUCTS_SERVICE,
  sendRpc,
  USERS_SERVICE,
} from '@app/common';
import { Controller, Get, Inject, Res } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { Response } from 'express';
import { Public } from '../common/decorators';

@ApiTags('Health')
@SkipThrottle()
@Controller('health')
export class HealthController {
  private readonly services: Record<string, ClientProxy>;

  constructor(
    @Inject(USERS_SERVICE) users: ClientProxy,
    @Inject(PRODUCTS_SERVICE) products: ClientProxy,
    @Inject(ORDERS_SERVICE) orders: ClientProxy,
    @Inject(NOTIFICATIONS_SERVICE) notifications: ClientProxy,
  ) {
    this.services = { users, products, orders, notifications };
  }

  @Public()
  @Get()
  @ApiOperation({ summary: 'Status of the gateway and every service' })
  async check(@Res({ passthrough: true }) res: Response) {
    const entries = await Promise.all(
      Object.entries(this.services).map(async ([name, client]) => {
        const started = Date.now();
        try {
          await sendRpc(client, PATTERNS.health, {}, 2000);
          return [name, { status: 'up', latencyMs: Date.now() - started }] as const;
        } catch {
          return [name, { status: 'down' }] as const;
        }
      }),
    );
    const services = Object.fromEntries(entries);
    const allUp = entries.every(([, s]) => s.status === 'up');
    res.status(allUp ? 200 : 503);
    return { status: allUp ? 'ok' : 'degraded', services, timestamp: new Date().toISOString() };
  }
}
