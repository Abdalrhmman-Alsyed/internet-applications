import {
  NOTIFICATIONS_SERVICE,
  ORDERS_SERVICE,
  PRODUCTS_SERVICE,
  tcpClient,
  USERS_SERVICE,
} from '@app/common';
import { Global, Module } from '@nestjs/common';
import { ClientsModule } from '@nestjs/microservices';

/** TCP clients to every service, available to all gateway modules. */
@Global()
@Module({
  imports: [
    ClientsModule.register([
      tcpClient(USERS_SERVICE, 'users'),
      tcpClient(PRODUCTS_SERVICE, 'products'),
      tcpClient(ORDERS_SERVICE, 'orders'),
      tcpClient(NOTIFICATIONS_SERVICE, 'notifications'),
    ]),
  ],
  exports: [ClientsModule],
})
export class ClientsConfigModule {}
