import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuthController } from './auth/auth.controller';
import { ClientsConfigModule } from './common/clients.module';
import { JwtAuthGuard, RolesGuard } from './common/guards';
import { HttpExceptionFilter } from './common/http-exception.filter';
import { HealthController, RATE_LIMIT, SystemController } from './health/health.controller';
import { HealthService } from './health/health.service';
import { NotificationsController } from './notifications/notifications.controller';
import { OrdersController } from './orders/orders.controller';
import { CategoriesController, ProductsController } from './products/products.controller';
import { UsersController } from './users/users.controller';

@Module({
  imports: [
    ClientsConfigModule,
    JwtModule.register({}),
    // Global rate limit per IP; auth routes override it with a stricter one.
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: RATE_LIMIT }]),
  ],
  controllers: [
    AuthController,
    UsersController,
    CategoriesController,
    ProductsController,
    OrdersController,
    NotificationsController,
    HealthController,
    SystemController,
  ],
  providers: [
    HealthService,
    // Order matters: rate limit → authenticate → authorise.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
  ],
})
export class AppModule {}
