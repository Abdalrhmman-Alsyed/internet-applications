import '@app/common/load-env';
import { AllRpcExceptionsFilter, declareNotificationsDeadLetter, eventsConsumerOptions, rabbitUrl, tcpServerOptions } from '@app/common';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import * as amqp from 'amqplib';
import { AppModule } from './app.module';
import { RedisIoAdapter } from './redis-io.adapter';

/** The dead-letter exchange/queue must exist before our queue starts pointing at it. */
async function declareTopology() {
  for (let attempt = 1; ; attempt++) {
    try {
      const conn = await amqp.connect(rabbitUrl());
      const ch = await conn.createChannel();
      await declareNotificationsDeadLetter(ch);
      await conn.close();
      return;
    } catch (err) {
      if (attempt >= 30) throw err;
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

/**
 * Hybrid app:
 *  - TCP      ← requests from the gateway (list / mark read)
 *  - RabbitMQ ← domain events from the other services
 *  - HTTP     ← Socket.io server for real-time pushes to clients
 */
async function bootstrap() {
  await declareTopology();
  const app = await NestFactory.create(AppModule);
  app.useGlobalFilters(new AllRpcExceptionsFilter());
  if (process.env.SOCKET_REDIS_ADAPTER === 'true') {
    const adapter = new RedisIoAdapter(app, process.env.REDIS_URL ?? 'redis://localhost:6379');
    await adapter.connect();
    app.useWebSocketAdapter(adapter);
  }
  app.connectMicroservice(tcpServerOptions('notifications'), { inheritAppConfig: true });
  app.connectMicroservice(eventsConsumerOptions(), { inheritAppConfig: true });
  app.enableShutdownHooks();
  await app.init();
  await app.startAllMicroservices();

  const wsPort = Number(process.env.WS_PORT ?? 3004);
  await app.listen(wsPort);
  Logger.log(`notifications-service: TCP :${tcpServerOptions('notifications').options!.port}, WebSocket :${wsPort}`, 'Bootstrap');
}
bootstrap();
