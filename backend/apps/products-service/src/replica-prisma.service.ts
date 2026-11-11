import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma-clients/products';

/**
 * Connection to the read replica (a live, read-only copy of the primary).
 * Without PRODUCTS_REPLICA_URL (local development) it simply points at the primary.
 */
@Injectable()
export class ReplicaPrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super({ datasourceUrl: process.env.PRODUCTS_REPLICA_URL ?? process.env.PRODUCTS_DATABASE_URL });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
