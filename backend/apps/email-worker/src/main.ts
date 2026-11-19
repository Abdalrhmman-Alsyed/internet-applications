import '@app/common/load-env';
import { declareEmailTopology, EMAIL_QUEUE, EMAIL_RETRY_QUEUE, OrderCreatedEvent, rabbitUrl } from '@app/common';
import { Logger } from '@nestjs/common';
import * as amqp from 'amqplib';
import Redis from 'ioredis';
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
 *    already sent is skipped (marker in Redis).
 */
const log = new Logger('EmailWorker');
const MAX_ATTEMPTS = Number(process.env.EMAIL_MAX_ATTEMPTS ?? 4); // first try + 3 retries
const RETRY_DELAYS_MS = (process.env.EMAIL_RETRY_DELAYS_MS ?? '5000,30000,120000').split(',').map(Number);
// Demo switch: "always" makes every send fail (to show retries and the DLQ).
const SIMULATE_FAILURE = process.env.SIMULATE_EMAIL_FAILURE ?? 'never';

const mailer = new Mailer();
const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', { maxRetriesPerRequest: 1, enableOfflineQueue: false });
redis.on('error', () => undefined); // Redis is only used for duplicate detection; never fatal

const sentKey = (orderId: string) => `email:sent:order:${orderId}`;

async function alreadySent(orderId: string) {
  try {
    return (await redis.exists(sentKey(orderId))) === 1;
  } catch {
    return false;
  }
}

async function markSent(orderId: string) {
  await redis.set(sentKey(orderId), '1', 'EX', 7 * 24 * 3600).catch(() => undefined);
}

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
    if (msg) void handle(channel, msg);
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

  try {
    if (await alreadySent(event.orderId)) {
      log.warn(`${ref}: email already sent earlier, skipping the duplicate delivery`);
      channel.ack(msg);
      return;
    }
    if (SIMULATE_FAILURE === 'always') throw new Error('Simulated SMTP failure (SIMULATE_EMAIL_FAILURE=always)');

    const messageId = await mailer.sendOrderConfirmation(event);
    await markSent(event.orderId);
    channel.ack(msg); // only now is the message removed from the queue
    log.log(`${ref}: confirmation sent to ${event.customerEmail} (attempt ${attempt}, ${messageId})`);
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
    try {
      // Park a copy in the retry queue; it expires after `delay` and RabbitMQ routes it
      // back to the main queue. Acknowledge the original only once the copy is stored.
      channel.sendToQueue(EMAIL_RETRY_QUEUE, msg.content, {
        persistent: true,
        expiration: String(delay),
        contentType: msg.properties.contentType,
        headers: { ...msg.properties.headers, 'x-attempt': attempt + 1, 'x-last-error': reason.slice(0, 200) },
      });
      await channel.waitForConfirms();
      channel.ack(msg);
    } catch (publishErr) {
      log.error(`${ref}: could not schedule the retry (${(publishErr as Error).message}), returning it to the queue`);
      channel.nack(msg, false, true);
    }
  }
}

main().catch((err) => {
  log.error(err);
  process.exit(1);
});
