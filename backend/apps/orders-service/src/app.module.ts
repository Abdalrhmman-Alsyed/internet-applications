import { eventsBusClient, PRODUCTS_SERVICE, tcpClient } from '@app/common';
import { Module } from '@nestjs/common';
import { ClientsModule } from '@nestjs/microservices';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { PrismaService } from './prisma.service';

@Module({
  imports: [ClientsModule.register([tcpClient(PRODUCTS_SERVICE, 'products'), eventsBusClient()])],
  controllers: [OrdersController],
  providers: [PrismaService, OrdersService],
})
export class AppModule {}
