import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import { HttpException, HttpStatus, Injectable, OnModuleDestroy } from '@nestjs/common';
import { existsSync } from 'fs';
import { join } from 'path';

export interface StockLevel {
  productId: string;
  quantity: number;
}

export interface StockItem {
  productId: string;
  quantity: number;
}

/** proto/inventory.proto: /app/proto in Docker, ../proto when running from backend/. */
function protoPath(): string {
  const candidates = [
    process.env.INVENTORY_PROTO_PATH,
    join(process.cwd(), 'proto', 'inventory.proto'),
    join(process.cwd(), '..', 'proto', 'inventory.proto'),
  ].filter((p): p is string => !!p);
  const found = candidates.find((p) => existsSync(p));
  if (!found) throw new Error(`inventory.proto not found (looked in: ${candidates.join(', ')})`);
  return found;
}

/** An inventory failure, already mapped to the HTTP status the API returns. */
export class InventoryException extends HttpException {
  constructor(
    status: HttpStatus,
    message: string,
    readonly grpcCode: grpc.status,
    readonly productId?: string,
    readonly available?: number,
  ) {
    // Same "error" wording as the rest of the API: 503 → "Service Unavailable".
    const error = (HttpStatus[status] ?? 'ERROR')
      .toLowerCase()
      .split('_')
      .map((w) => w[0].toUpperCase() + w.slice(1))
      .join(' ');
    super({ statusCode: status, message, error }, status);
  }
}

/**
 * gRPC client for inventory-service (Go). Every call carries a deadline: if the
 * service is down or slow, the caller gets a clear 503/504 instead of waiting forever.
 */
@Injectable()
export class InventoryClient implements OnModuleDestroy {
  readonly target = process.env.INVENTORY_GRPC_URL ?? 'localhost:50051';
  readonly deadlineMs = Number(process.env.INVENTORY_DEADLINE_MS ?? 2000);
  // Methods are created at runtime from the .proto file, so the client is untyped here;
  // the typed wrappers below are the only way it is used.
  private readonly client: any;

  constructor() {
    const definition = protoLoader.loadSync(protoPath(), {
      keepCase: false, // product_id ↔ productId
      longs: Number,
      enums: String,
      defaults: true, // a missing int32 reads as 0
      oneofs: true,
    });
    const pkg = grpc.loadPackageDefinition(definition) as any;
    this.client = new pkg.inventory.v1.InventoryService(this.target, grpc.credentials.createInsecure());
  }

  onModuleDestroy() {
    this.client.close();
  }

  /**
   * Stock per product id (unknown products count as 0). Only for display, so it gets a
   * shorter deadline: browsing must not stall when inventory is down.
   */
  async checkStock(productIds: string[]): Promise<Map<string, number>> {
    if (!productIds.length) return new Map();
    const res = await this.call<{ items: StockLevel[] }>('CheckStock', { productIds }, Math.min(this.deadlineMs, 1000));
    return new Map(res.items.map((i) => [i.productId, i.quantity]));
  }

  /** All or nothing. Returns the stock left per product. */
  async reserve(reservationId: string, items: StockItem[]): Promise<StockLevel[]> {
    const res = await this.call<{ remaining: StockLevel[] }>('ReserveStock', { reservationId, items });
    return res.remaining;
  }

  /** Idempotent: releasing twice, or releasing something never reserved, is a no-op. */
  async release(reservationId: string): Promise<{ released: boolean; restored: StockLevel[] }> {
    return this.call('ReleaseStock', { reservationId });
  }

  async setStock(productId: string, change: { quantity: number } | { delta: number }): Promise<number> {
    const res = await this.call<StockLevel>('SetStock', { productId, ...change });
    return res.quantity;
  }

  /** Product ids whose stock is within [min, max]. */
  async listStock(range: { min?: number; max?: number }): Promise<StockLevel[]> {
    const res = await this.call<{ items: StockLevel[] }>('ListStock', { minQuantity: range.min, maxQuantity: range.max });
    return res.items;
  }

  /** Round trip used by the health check. */
  async ping(timeoutMs = 2000): Promise<void> {
    await this.call('CheckStock', { productIds: [] }, timeoutMs);
  }

  private call<T>(method: string, request: object, deadlineMs = this.deadlineMs): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const deadline = new Date(Date.now() + deadlineMs);
      this.client[method](request, new grpc.Metadata(), { deadline }, (err: grpc.ServiceError | null, res: T) =>
        err ? reject(this.toHttp(err, deadlineMs)) : resolve(res),
      );
    });
  }

  private toHttp(err: grpc.ServiceError, deadlineMs: number): InventoryException {
    const productId = err.metadata?.get('product-id')[0]?.toString();
    const availableRaw = err.metadata?.get('available')[0]?.toString();
    const available = availableRaw === undefined ? undefined : Number(availableRaw);
    const ex = (status: HttpStatus, message: string) => new InventoryException(status, message, err.code, productId, available);

    switch (err.code) {
      case grpc.status.INVALID_ARGUMENT:
        return ex(HttpStatus.BAD_REQUEST, err.details);
      case grpc.status.NOT_FOUND:
        return ex(HttpStatus.NOT_FOUND, err.details);
      case grpc.status.FAILED_PRECONDITION:
      case grpc.status.ABORTED:
        return ex(HttpStatus.CONFLICT, err.details);
      case grpc.status.DEADLINE_EXCEEDED:
        // Never connected (service stopped) vs connected but too slow: same wait, clearer message.
        if (this.client.getChannel().getConnectivityState(false) !== grpc.connectivityState.READY) {
          return ex(HttpStatus.SERVICE_UNAVAILABLE, `Inventory service is unreachable (no answer within ${deadlineMs} ms). Please try again shortly.`);
        }
        return ex(HttpStatus.GATEWAY_TIMEOUT, `Inventory service did not answer within ${deadlineMs} ms. Please try again.`);
      default: // UNAVAILABLE (down / unreachable) and anything unexpected
        return ex(HttpStatus.SERVICE_UNAVAILABLE, 'Inventory service is unavailable. Please try again shortly.');
    }
  }
}
