import {
  InventoryClient,
  NOTIFICATIONS_SERVICE,
  ORDERS_SERVICE,
  PATTERNS,
  PRODUCTS_SERVICE,
  sendRpc,
  USERS_SERVICE,
} from '@app/common';
import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';

export interface ServiceStatus {
  status: 'up' | 'down';
  latencyMs?: number;
}

@Injectable()
export class HealthService {
  private readonly services: Record<string, ClientProxy>;

  constructor(
    @Inject(USERS_SERVICE) users: ClientProxy,
    @Inject(PRODUCTS_SERVICE) products: ClientProxy,
    @Inject(ORDERS_SERVICE) orders: ClientProxy,
    @Inject(NOTIFICATIONS_SERVICE) notifications: ClientProxy,
    private readonly inventory: InventoryClient,
  ) {
    this.services = { users, products, orders, notifications };
  }

  /** Pings every service (TCP, and gRPC for inventory) and measures the round trip. */
  async check(): Promise<Record<string, ServiceStatus>> {
    const probes: [string, () => Promise<unknown>][] = [
      ...Object.entries(this.services).map(([name, client]): [string, () => Promise<unknown>] => [
        name,
        () => sendRpc(client, PATTERNS.health, {}, 2000),
      ]),
      ['inventory', () => this.inventory.ping(2000)],
    ];
    const entries = await Promise.all(
      probes.map(async ([name, probe]): Promise<[string, ServiceStatus]> => {
        const started = Date.now();
        try {
          await probe();
          return [name, { status: 'up', latencyMs: Date.now() - started }];
        } catch {
          return [name, { status: 'down' }];
        }
      }),
    );
    return Object.fromEntries(entries);
  }
}
