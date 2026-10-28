import '@app/common/load-env';
import { AllRpcExceptionsFilter, eventsConsumerOptions, tcpServerOptions } from '@app/common';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

/**
 * Hybrid app:
 *  - TCP      ← requests from the gateway (list / mark read)
 *  - RabbitMQ ← domain events from the other services
 *  - HTTP     ← Socket.io server for real-time pushes to clients
 */
async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalFilters(new AllRpcExceptionsFilter());
  app.connectMicroservice(tcpServerOptions('notifications'), { inheritAppConfig: true });
  app.connectMicroservice(eventsConsumerOptions(), { inheritAppConfig: true });
  app.enableShutdownHooks();
  await app.startAllMicroservices();

  const wsPort = Number(process.env.WS_PORT ?? 3004);
  await app.listen(wsPort);
  Logger.log(`notifications-service: TCP :${tcpServerOptions('notifications').options!.port}, WebSocket :${wsPort}`, 'Bootstrap');
}
bootstrap();
