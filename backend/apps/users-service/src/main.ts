import '@app/common/load-env';
import { AllRpcExceptionsFilter, tcpServerOptions } from '@app/common';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.createMicroservice(AppModule, tcpServerOptions('users'));
  app.useGlobalFilters(new AllRpcExceptionsFilter());
  app.enableShutdownHooks();
  await app.listen();
  Logger.log(`users-service listening on TCP :${tcpServerOptions('users').options!.port}`, 'Bootstrap');
}
bootstrap();
