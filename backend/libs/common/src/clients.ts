import { ClientProviderOptions, RmqOptions, TcpOptions, Transport } from '@nestjs/microservices';
import { DEFAULT_PORTS, EVENTS_BUS, NOTIFICATIONS_QUEUE } from './constants';

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

/** Publisher for domain events. Durable queue so events survive a consumer restart. */
export function eventsBusClient(): ClientProviderOptions {
  return {
    name: EVENTS_BUS,
    transport: Transport.RMQ,
    options: { urls: [rmqUrl()], queue: NOTIFICATIONS_QUEUE, queueOptions: { durable: true }, persistent: true },
  };
}

/** Consumer side, with manual acknowledgement. */
export function eventsConsumerOptions(): RmqOptions {
  return {
    transport: Transport.RMQ,
    options: {
      urls: [rmqUrl()],
      queue: NOTIFICATIONS_QUEUE,
      queueOptions: { durable: true },
      noAck: false,
      prefetchCount: 10,
    },
  };
}
