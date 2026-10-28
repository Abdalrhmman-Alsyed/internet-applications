import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { NotificationsController } from './notifications.controller';
import { NotificationsGateway } from './notifications.gateway';
import { NotificationsService } from './notifications.service';
import { PrismaService } from './prisma.service';

@Module({
  imports: [JwtModule.register({})],
  controllers: [NotificationsController],
  providers: [PrismaService, NotificationsGateway, NotificationsService],
})
export class AppModule {}
