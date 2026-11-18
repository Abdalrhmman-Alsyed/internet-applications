import { ClientProviderOptions, RmqOptions, TcpOptions, Transport } from '@nestjs/microservices';
import { DEFAULT_PORTS, EVENTS_BUS, EVENTS_EXCHANGE, NOTIFICATIONS_DLX, NOTIFICATIONS_QUEUE } from './constants';

type ServiceName = keyof typeof DEFAULT_PORTS;

function hostOf(service: ServiceName): string {
  return process.env[`${service.toUpperCase()}_HOST`] ?? 'localhost';
}

export function portOf(service: ServiceName): number {
  return Number(process.env[`${service.toUpperCase()}_PORT`] ?? DEFAULT_PORTS[service]);
}

/** Options a service uses to listen for TCP requests. */
export function tcpServerOptions(service: ServiceName): TcpOptions {
  return { transport: Transport.TCP, options: { host: '0.0.0.0', port: portOf(service) } };
}

/** Client registration used to call another service over TCP. */
export function tcpClient(token: string, service: ServiceName): ClientProviderOptions {
  return { name: token, transport: Transport.TCP, options: { host: hostOf(service), port: portOf(service) } };
}

const rmqUrl = () => process.env.RABBITMQ_URL ?? 'amqp://app:app_password@localhost:5672';

/**
 * Publisher for domain events: publishes to the topic exchange "events" with the event
 * name as routing key (order.created, order.status_changed, …). Messages are persistent
 * (written to disk), and every queue bound to the exchange gets its own copy.
 */
export function eventsBusClient(): ClientProviderOptions {
  return {
    name: EVENTS_BUS,
    transport: Transport.RMQ,
    options: { urls: [rmqUrl()], exchange: EVENTS_EXCHANGE, exchangeType: 'topic', wildcards: true, persistent: true },
  };
}

/**
 * notifications-service: its own durable queue, bound to the exchange for the events it
 * handles. Manual acknowledgement; a message it rejects goes to its dead-letter queue.
 */
export function eventsConsumerOptions(): RmqOptions {
  return {
    transport: Transport.RMQ,
    options: {
      urls: [rmqUrl()],
      exchange: EVENTS_EXCHANGE,
      exchangeType: 'topic',
      wildcards: true,
      queue: NOTIFICATIONS_QUEUE,
      queueOptions: { durable: true, arguments: { 'x-dead-letter-exchange': NOTIFICATIONS_DLX } },
      noAck: false,
      prefetchCount: 10,
    },
  };
}

export const rabbitUrl = rmqUrl;
