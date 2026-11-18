import { ORDERS_SERVICE, tcpClient } from '@app/common';
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ClientsModule } from '@nestjs/microservices';
import { NotificationsController } from './notifications.controller';
import { NotificationsGateway } from './notifications.gateway';
import { NotificationsService } from './notifications.service';
import { PrismaService } from './prisma.service';

@Module({
  // orders-service is asked whether a user may follow an order before they join its channel.
  imports: [JwtModule.register({}), ClientsModule.register([tcpClient(ORDERS_SERVICE, 'orders')])],
  controllers: [NotificationsController],
  providers: [PrismaService, NotificationsGateway, NotificationsService],
})
export class AppModule {}
