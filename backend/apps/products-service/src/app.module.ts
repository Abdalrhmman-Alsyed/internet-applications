import { CacheService, eventsBusClient, InventoryClient } from '@app/common';
import { Module } from '@nestjs/common';
import { ClientsModule } from '@nestjs/microservices';
import { CategoriesService } from './categories.service';
import { PrismaService } from './prisma.service';
import { ReplicaPrismaService } from './replica-prisma.service';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';
import { StorageService } from './storage.service';

@Module({
  imports: [ClientsModule.register([eventsBusClient()])],
  controllers: [ProductsController],
  providers: [PrismaService, ReplicaPrismaService, StorageService, ProductsService, CategoriesService, InventoryClient, CacheService],
})
export class AppModule {}
