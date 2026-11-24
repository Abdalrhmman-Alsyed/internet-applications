import '@app/common/load-env';
import { declareEmailTopology, EMAIL_QUEUE, EMAIL_RETRY_QUEUE, OrderCreatedEvent, rabbitUrl } from '@app/common';
import { Logger } from '@nestjs/common';
import * as amqp from 'amqplib';
import Redis from 'ioredis';
import { randomUUID } from 'node:crypto';
import { Mailer } from './mailer';

/**
 * email-worker (requirement 4): sends the order confirmation email in the background.
 *
 *  - It consumes its own queue (email.order-created), which gets a copy of every
 *    order.created event. The customer already had their answer; nobody waits for this.
 *  - A message is acknowledged ONLY after the email was really sent. If the worker is
 *    stopped or crashes, unacknowledged messages stay in the queue and come back.
 *  - A failed send is retried later (back-off: 5 s, 30 s, 2 min by default). After the
 *    last attempt the message is rejected and RabbitMQ moves it to the dead-letter queue
 *    (email.dead), so one bad message never blocks the others.
 *  - Delivery is "at least once", so the worker is idempotent: an order whose email was
 *    already sent is skipped. An atomic Redis lease prevents simultaneous sends.
 */
const log = new Logger('EmailWorker');
const MAX_ATTEMPTS = Number(process.env.EMAIL_MAX_ATTEMPTS ?? 4); // first try + 3 retries
const RETRY_DELAYS_MS = (process.env.EMAIL_RETRY_DELAYS_MS ?? '5000,30000,120000').split(',').map(Number);
// Demo switch: "always" makes every send fail (to show retries and the DLQ).
const SIMULATE_FAILURE = process.env.SIMULATE_EMAIL_FAILURE ?? 'never';

const mailer = new Mailer();
const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
  maxRetriesPerRequest: 1,
  enableOfflineQueue: false,
  commandTimeout: 2000,
});
redis.on('error', (err) => log.warn(`Redis: ${err.message}`));

const sentKey = (orderId: string) => `email:sent:order:${orderId}`;
const leaseKey = (orderId: string) => `email:lease:order:${orderId}`;
const LEASE_MS = 120_000;
const SENT_SECONDS = 7 * 24 * 3600;

async function claim(orderId: string, token: string) {
  return redis.eval(`
    if redis.call('EXISTS', KEYS[1]) == 1 then return 'sent' end
    if redis.call('SET', KEYS[2], ARGV[1], 'NX', 'PX', ARGV[2]) then return 'claimed' end
    return 'busy'
  `, 2, sentKey(orderId), leaseKey(orderId), token, LEASE_MS);
}

const RELEASE = `
  if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end
  return 0
`;
const COMPLETE = `
  if redis.call('GET', KEYS[2]) ~= ARGV[1] then return 0 end
  redis.call('SET', KEYS[1], '1', 'EX', ARGV[2])
  redis.call('DEL', KEYS[2])
  return 1
`;

async function connect(): Promise<amqp.Connection> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await amqp.connect(rabbitUrl());
    } catch (err) {
      if (attempt >= 30) throw err;
      log.warn(`RabbitMQ not reachable yet (${(err as Error).message}), retrying...`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

async function main() {
  const connection = await connect();
  // A confirm channel: a re-published retry is only acknowledged by the broker once it
  // is safely stored, so a message can't be lost between "re-queue" and "ack".
  const channel = await connection.createConfirmChannel();
  await declareEmailTopology(channel);
  await channel.prefetch(5); // at most 5 unacknowledged messages at a time

  log.log(`SMTP ${mailer.server}: ${(await mailer.verify()) ? 'reachable' : 'NOT reachable (sends will be retried)'}`);
  log.log(`Waiting for order.created on "${EMAIL_QUEUE}" (max ${MAX_ATTEMPTS} attempts, retry after ${RETRY_DELAYS_MS.join('/')} ms, failure simulation: ${SIMULATE_FAILURE})`);

  await channel.consume(EMAIL_QUEUE, (msg: amqp.ConsumeMessage | null) => {
    if (msg) void handle(channel, msg).catch((err) => log.error(err));
  });

  let stopping = false;
  const shutdown = async () => {
    stopping = true;
    log.log('Stopping: unacknowledged messages go back to the queue');
    await channel.close().catch(() => undefined);
    await connection.close().catch(() => undefined);
    redis.disconnect();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
  connection.on('close', () => {
    if (stopping) return; // a normal stop, not a lost connection
    log.error('RabbitMQ connection closed, exiting (Docker restarts the worker)');
    process.exit(1);
  });
}

async function handle(channel: amqp.ConfirmChannel, msg: amqp.ConsumeMessage) {
  const attempt = Number(msg.properties.headers?.['x-attempt'] ?? 1);

  let event: OrderCreatedEvent;
  try {
    const packet = JSON.parse(msg.content.toString()); // NestJS publishes { pattern, data }
    event = packet.data ?? packet;
    if (!event?.orderId || !event.customerEmail) throw new Error('missing orderId or customerEmail');
  } catch (err) {
    // A message we can never understand: retrying is pointless, straight to the DLQ.
    log.error(`Unreadable message, sending it to the dead-letter queue: ${(err as Error).message}`);
    channel.nack(msg, false, false);
    return;
  }
  const ref = `#${event.orderId.slice(0, 8)}`;
  const token = randomUUID();
  let ownsLease = false;

  try {
    const result = await claim(event.orderId, token);
    if (result === 'sent') {
      log.warn(`${ref}: email already sent earlier, skipping the duplicate delivery`);
      channel.ack(msg);
      return;
    }
    if (result === 'busy') {
      await scheduleRetry(channel, msg, attempt, 1500, 'Another worker has the email lease');
      return;
    }
    ownsLease = true;
    if (SIMULATE_FAILURE === 'always') throw new Error('Simulated SMTP failure (SIMULATE_EMAIL_FAILURE=always)');

    const messageId = await mailer.sendOrderConfirmation(event);
    const marked = await redis.eval(COMPLETE, 2, sentKey(event.orderId), leaseKey(event.orderId), token, SENT_SECONDS);
    if (marked !== 1) throw new Error('Email lease expired before recording delivery');
    channel.ack(msg); // only now is the message removed from the queue
    log.log(`${ref}: confirmation sent (attempt ${attempt}, ${messageId})`);
  } catch (err) {
    const reason = (err as Error).message;
    if (attempt >= MAX_ATTEMPTS) {
      // Rejected without requeue: RabbitMQ dead-letters it to email.dlx → email.dead.
      log.error(`${ref}: attempt ${attempt}/${MAX_ATTEMPTS} failed (${reason}). Giving up → dead-letter queue`);
      channel.nack(msg, false, false);
      return;
    }
    const delay = RETRY_DELAYS_MS[Math.min(attempt - 1, RETRY_DELAYS_MS.length - 1)];
    log.warn(`${ref}: attempt ${attempt}/${MAX_ATTEMPTS} failed (${reason}). Retrying in ${delay} ms`);
    await scheduleRetry(channel, msg, attempt + 1, delay, reason);
  } finally {
    if (ownsLease) {
      await redis.eval(RELEASE, 1, leaseKey(event.orderId), token).catch((err: Error) => log.warn(err.message));
    }
  }
}

async function scheduleRetry(channel: amqp.ConfirmChannel, msg: amqp.ConsumeMessage, attempt: number, delay: number, reason: string) {
  try {
    await new Promise<void>((resolve, reject) => {
      channel.sendToQueue(EMAIL_RETRY_QUEUE, msg.content, {
        persistent: true,
        expiration: String(delay),
        contentType: msg.properties.contentType,
        messageId: msg.properties.messageId,
        headers: { ...msg.properties.headers, 'x-attempt': attempt, 'x-last-error': reason.slice(0, 200) },
      }, (err) => (err ? reject(err) : resolve()));
    });
    channel.ack(msg);
  } catch (err) {
    log.error(`Could not schedule the retry: ${(err as Error).message}`);
    channel.nack(msg, false, true);
  }
}

main().catch((err) => {
  log.error(err);
  process.exit(1);
});
