import '@app/common/load-env';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.use(helmet());
  app.enableCors({
    origin: (process.env.CORS_ORIGINS ?? 'http://localhost:3001').split(','),
    credentials: true,
  });
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // strip unknown fields (e.g. "role": "ADMIN" on register)
      forbidNonWhitelisted: true, // ...and reject the request instead of silently ignoring them
      transform: true,
    }),
  );
  app.enableShutdownHooks();

  const config = new DocumentBuilder()
    .setTitle('E-Commerce API')
    .setDescription(
      'API Gateway for the e-commerce microservices.\n\n' +
        '1. Log in with `POST /api/v1/auth/login` (seeded admin: `admin@shop.local` / `Admin@12345`).\n' +
        '2. Click **Authorize** and paste the `accessToken`.\n\n' +
        'Every error uses the same shape: `{ success, statusCode, error, message, path, method, timestamp }`.',
    )
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, config), {
    jsonDocumentUrl: 'docs/openapi.json',
    swaggerOptions: { persistAuthorization: true },
  });

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  Logger.log(`API Gateway on http://localhost:${port}/api/v1 — Swagger: http://localhost:${port}/docs`, 'Bootstrap');
}
bootstrap();
