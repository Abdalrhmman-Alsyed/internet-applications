import { INestApplication, Logger } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';
import { Server, ServerOptions } from 'socket.io';

export class RedisIoAdapter extends IoAdapter {
  private readonly publisher: Redis;
  private readonly subscriber: Redis;

  constructor(app: INestApplication, url: string) {
    super(app);
    const logger = new Logger(RedisIoAdapter.name);
    this.publisher = new Redis(url, { lazyConnect: true, enableOfflineQueue: false, maxRetriesPerRequest: 1 });
    this.subscriber = this.publisher.duplicate();
    this.publisher.on('error', (err) => logger.warn(err.message));
    this.subscriber.on('error', (err) => logger.warn(err.message));
  }

  async connect() {
    await Promise.all([this.publisher.connect(), this.subscriber.connect()]);
  }

  override createIOServer(port: number, options?: ServerOptions): Server {
    const server: Server = super.createIOServer(port, { ...options, transports: ['websocket'] });
    server.adapter(createAdapter(this.publisher, this.subscriber, { key: 'ecommerce:socket.io' }));
    return server;
  }

  override async dispose() {
    this.publisher.disconnect();
    this.subscriber.disconnect();
  }
}
