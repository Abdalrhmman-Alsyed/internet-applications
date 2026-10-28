import '@app/common/load-env';
import { AllRpcExceptionsFilter, tcpServerOptions } from '@app/common';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.createMicroservice(AppModule, tcpServerOptions('orders'));
  app.useGlobalFilters(new AllRpcExceptionsFilter());
  app.enableShutdownHooks();
  await app.listen();
  Logger.log(`orders-service listening on TCP :${tcpServerOptions('orders').options!.port}`, 'Bootstrap');
}
bootstrap();
