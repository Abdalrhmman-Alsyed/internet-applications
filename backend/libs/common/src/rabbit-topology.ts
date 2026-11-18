import * as amqp from 'amqplib';
import {
  EMAIL_DLQ,
  EMAIL_DLX,
  EMAIL_QUEUE,
  EMAIL_RETRY_QUEUE,
  EVENTS,
  EVENTS_EXCHANGE,
  NOTIFICATIONS_DLQ,
  NOTIFICATIONS_DLX,
} from './constants';

/**
 * RabbitMQ layout for requirement 4. Every declaration is idempotent, so each consumer
 * declares what it needs on start-up.
 *
 *   publishers ──► [events] (topic exchange)
 *                     ├── order.created, order.status_changed, … ──► notifications.events ─(rejected)─► [notifications.dlx] ──► notifications.dead
 *                     └── order.created ──────────────────────────► email.order-created
 *                                                                      │   failed, attempts left ──► email.retry (waits, then back)
 *                                                                      └── failed for good ─(dead-letter)─► [email.dlx] ──► email.dead
 */
export async function declareEventsExchange(ch: amqp.Channel) {
  await ch.assertExchange(EVENTS_EXCHANGE, 'topic', { durable: true });
}

export async function declareNotificationsDeadLetter(ch: amqp.Channel) {
  await declareEventsExchange(ch);
  await ch.assertExchange(NOTIFICATIONS_DLX, 'fanout', { durable: true });
  await ch.assertQueue(NOTIFICATIONS_DLQ, { durable: true });
  await ch.bindQueue(NOTIFICATIONS_DLQ, NOTIFICATIONS_DLX, '');
}

export async function declareEmailTopology(ch: amqp.Channel) {
  await declareEventsExchange(ch);

  // Dead-letter queue: messages that failed every attempt land here and wait for a human.
  await ch.assertExchange(EMAIL_DLX, 'fanout', { durable: true });
  await ch.assertQueue(EMAIL_DLQ, { durable: true });
  await ch.bindQueue(EMAIL_DLQ, EMAIL_DLX, '');

  // Main queue: gets its own copy of every order.created. A message the worker rejects
  // (nack without requeue) is moved by RabbitMQ to the dead-letter exchange above.
  await ch.assertQueue(EMAIL_QUEUE, { durable: true, arguments: { 'x-dead-letter-exchange': EMAIL_DLX } });
  await ch.bindQueue(EMAIL_QUEUE, EVENTS_EXCHANGE, EVENTS.orderCreated);

  // Retry queue: nobody consumes it. A message waits here for its "expiration" (the
  // back-off delay), then RabbitMQ dead-letters it back into the main queue.
  await ch.assertQueue(EMAIL_RETRY_QUEUE, {
    durable: true,
    arguments: { 'x-dead-letter-exchange': '', 'x-dead-letter-routing-key': EMAIL_QUEUE },
  });
}
