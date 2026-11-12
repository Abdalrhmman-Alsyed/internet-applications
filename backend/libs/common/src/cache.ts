import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { PERF_OPTIMIZED } from './perf';

/** Must be longer than the replica can lag behind the primary (normally milliseconds). */
const FRESH_WINDOW_SECONDS = Number(process.env.FRESH_WINDOW_SECONDS ?? 5);

/**
 * Redis cache, "cache-aside": read the cache, on a miss load from the database and
 * store the result with a TTL. Writers invalidate.
 *
 * The cache is an optimisation, never a dependency: if Redis is down every call
 * falls through to the database and the app keeps working (just slower).
 */
@Injectable()
export class CacheService implements OnModuleDestroy {
  private readonly logger = new Logger(CacheService.name);
  private readonly redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false, // fail fast when Redis is down instead of queueing commands
    lazyConnect: false,
  });
  /** Concurrent misses for the same key share one database load (no stampede). */
  private readonly inflight = new Map<string, Promise<unknown>>();

  constructor() {
    this.redis.on('error', (err) => this.logger.warn(`Redis: ${err.message}`));
  }

  onModuleDestroy() {
    this.redis.disconnect();
  }

  async getOrSet<T>(key: string, ttlSeconds: number, load: () => Promise<T>): Promise<T> {
    if (!PERF_OPTIMIZED) return load(); // PERF_MODE=before: no cache, every read hits the database
    const cached = await this.get<T>(key);
    // Our own hit/miss counters: Redis's global keyspace stats also count the
    // read-your-writes lookups, which would hide the real cache hit rate.
    this.redis.incr(cached !== undefined ? 'stats:cache:hits' : 'stats:cache:misses').catch(() => undefined);
    if (cached !== undefined) return cached;

    const pending = this.inflight.get(key) as Promise<T> | undefined;
    if (pending) return pending;
    const loading = load()
      .then(async (value) => {
        await this.set(key, value, ttlSeconds);
        return value;
      })
      .finally(() => this.inflight.delete(key));
    this.inflight.set(key, loading);
    return loading;
  }

  async get<T>(key: string): Promise<T | undefined> {
    try {
      const raw = await this.redis.get(key);
      return raw === null ? undefined : (JSON.parse(raw) as T);
    } catch {
      return undefined;
    }
  }

  async set(key: string, value: unknown, ttlSeconds: number) {
    try {
      await this.redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
    } catch {
      /* cache unavailable: nothing to do */
    }
  }

  async del(...keys: string[]) {
    try {
      if (keys.length) await this.redis.del(...keys);
    } catch (err) {
      this.logger.warn(`Could not invalidate ${keys.join(', ')}: ${(err as Error).message}`);
    }
  }

  /**
   * A version number that is part of every key of a group (e.g. the catalogue).
   * Bumping it makes all old keys unreachable at once; they expire on their own TTL.
   */
  async version(name: string): Promise<number> {
    try {
      return Number((await this.redis.get(`v:${name}`)) ?? 0);
    } catch {
      return -1; // Redis down: a version no key uses, so nothing stale is read
    }
  }

  async bump(name: string) {
    try {
      await this.redis.incr(`v:${name}`);
    } catch (err) {
      this.logger.warn(`Could not bump ${name}: ${(err as Error).message}`);
    }
  }

  /**
   * Read-your-writes with a read replica: after a write, mark `scope` as "fresh" for a
   * few seconds (longer than the replica ever lags). While marked, reads for that scope
   * go to the primary, so nobody is shown data older than what they just wrote.
   */
  async markFresh(scope: string) {
    await this.set(`fresh:${scope}`, 1, FRESH_WINDOW_SECONDS);
  }

  /** true → read from the primary. If Redis is down we can't know, so we play safe: primary. */
  async isFresh(scope: string): Promise<boolean> {
    try {
      return (await this.redis.exists(`fresh:${scope}`)) === 1;
    } catch {
      return true;
    }
  }
}
