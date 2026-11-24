import { Injectable, Logger, OnApplicationShutdown, ServiceUnavailableException } from '@nestjs/common';
import { ThrottlerOptionsFactory, ThrottlerStorage } from '@nestjs/throttler';
import Redis from 'ioredis';
import { randomUUID } from 'node:crypto';
import { RATE_LIMIT } from '../health/health.controller';

// Use the Redis clock and apply pruning, increment, blocking and expiry atomically.
const INCREMENT = `
local hitsKey, blockKey = KEYS[1], KEYS[2]
local ttl, limit, blockDuration = tonumber(ARGV[1]), tonumber(ARGV[2]), tonumber(ARGV[3])
local clock = redis.call('TIME')
local now = clock[1] * 1000 + math.floor(clock[2] / 1000)
redis.call('ZREMRANGEBYSCORE', hitsKey, '-inf', now - ttl)
local hits = redis.call('ZCARD', hitsKey)
local blockedFor = redis.call('PTTL', blockKey)
if blockedFor > 0 then
  return {math.max(hits, limit + 1), 0, 1, math.ceil(blockedFor / 1000)}
end
if hits >= limit and blockDuration == 0 then
  local oldest = redis.call('ZRANGE', hitsKey, 0, 0, 'WITHSCORES')
  local seconds = math.ceil((oldest[2] and ttl - (now - tonumber(oldest[2])) or ttl) / 1000)
  return {hits + 1, seconds, 1, seconds}
end
if hits >= limit then
  redis.call('SET', blockKey, '1', 'PX', blockDuration)
  redis.call('DEL', hitsKey)
  return {hits + 1, math.ceil(ttl / 1000), 1, math.ceil(blockDuration / 1000)}
end
redis.call('ZADD', hitsKey, now, ARGV[4])
redis.call('PEXPIRE', hitsKey, ttl)
local oldest = redis.call('ZRANGE', hitsKey, 0, 0, 'WITHSCORES')
return {hits + 1, math.ceil((ttl - (now - tonumber(oldest[2]))) / 1000), 0, 0}
`;

@Injectable()
export class RedisThrottlerStorage implements ThrottlerStorage, ThrottlerOptionsFactory, OnApplicationShutdown {
  private readonly logger = new Logger(RedisThrottlerStorage.name);
  private readonly redis = new Redis(process.env.REDIS_URL!, {
    enableOfflineQueue: false,
    maxRetriesPerRequest: 0,
    commandTimeout: 1000,
  });

  constructor() {
    this.redis.on('error', (err) => this.logger.warn(err.message));
  }

  createThrottlerOptions() {
    return { throttlers: [{ name: 'default', ttl: 60_000, limit: RATE_LIMIT }], storage: this };
  }

  async increment(key: string, ttl: number, limit: number, blockDuration: number, throttlerName: string) {
    const prefix = `throttle:{${throttlerName}:${key}}`;
    try {
      const [totalHits, timeToExpire, blocked, timeToBlockExpire] = await this.redis.eval(
        INCREMENT, 2, `${prefix}:hits`, `${prefix}:block`, ttl, limit, blockDuration, randomUUID(),
      ) as number[];
      return { totalHits, timeToExpire, isBlocked: blocked === 1, timeToBlockExpire };
    } catch {
      throw new ServiceUnavailableException('Rate limiter is unavailable');
    }
  }

  // Keep throttling available until the HTTP server closes and drains its requests.
  onApplicationShutdown() {
    this.redis.disconnect();
  }
}
