import { eventsBusClient } from '@app/common';
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ClientsModule } from '@nestjs/microservices';
import { AuthService } from './auth.service';
import { PrismaService } from './prisma.service';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  imports: [JwtModule.register({}), ClientsModule.register([eventsBusClient()])],
  controllers: [UsersController],
  providers: [PrismaService, UsersService, AuthService],
})
export class AppModule {}
