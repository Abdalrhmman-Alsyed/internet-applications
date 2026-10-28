import { AuthUser, NOTIFICATIONS_SERVICE, PATTERNS, sendRpc } from '@app/common';
import { Controller, Get, Inject, Param, ParseUUIDPipe, Patch, Query } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators';
import { NotificationsQueryDto } from './notifications.dto';

@ApiTags('Notifications')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationsController {
  constructor(@Inject(NOTIFICATIONS_SERVICE) private readonly notifications: ClientProxy) {}

  @Get()
  @ApiOperation({ summary: 'My notifications (real-time pushes: Socket.io on port 3004, event "notification")' })
  findAll(@CurrentUser() user: AuthUser, @Query() query: NotificationsQueryDto) {
    return sendRpc(this.notifications, PATTERNS.notifications.findAll, { user, query });
  }

  @Patch('read-all')
  @ApiOperation({ summary: 'Mark all my notifications as read' })
  markAllRead(@CurrentUser() user: AuthUser) {
    return sendRpc(this.notifications, PATTERNS.notifications.markAllRead, { user });
  }

  @Patch(':id/read')
  @ApiOperation({ summary: 'Mark one notification as read' })
  markRead(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return sendRpc(this.notifications, PATTERNS.notifications.markRead, { user, id });
  }
}
