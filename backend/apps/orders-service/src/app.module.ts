import { CacheService, eventsBusClient, InventoryClient, PRODUCTS_SERVICE, tcpClient } from '@app/common';
import { Module } from '@nestjs/common';
import { ClientsModule } from '@nestjs/microservices';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { PrismaService } from './prisma.service';
import { ReplicaPrismaService } from './replica-prisma.service';

@Module({
  imports: [ClientsModule.register([tcpClient(PRODUCTS_SERVICE, 'products'), eventsBusClient()])],
  controllers: [OrdersController],
  providers: [PrismaService, ReplicaPrismaService, OrdersService, InventoryClient, CacheService],
})
export class AppModule {}
