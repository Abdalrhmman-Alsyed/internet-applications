import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma-clients/orders';

/**
 * Connection to the read replica (a live, read-only copy of the primary).
 * Without ORDERS_REPLICA_URL (local development) it simply points at the primary.
 */
@Injectable()
export class ReplicaPrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super({ datasourceUrl: process.env.ORDERS_REPLICA_URL ?? process.env.ORDERS_DATABASE_URL });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
