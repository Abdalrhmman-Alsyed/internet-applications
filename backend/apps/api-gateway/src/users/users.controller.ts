import { AuthUser, PATTERNS, Role, sendRpc, USERS_SERVICE } from '@app/common';
import { Body, Controller, Get, Inject, Param, ParseUUIDPipe, Patch, Query } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { ApiBearerAuth, ApiForbiddenResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, Roles } from '../common/decorators';
import { UpdateMeDto, UsersQueryDto } from './users.dto';

@ApiTags('Users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(@Inject(USERS_SERVICE) private readonly users: ClientProxy) {}

  @Get('me')
  @ApiOperation({ summary: 'Current user profile' })
  me(@CurrentUser() user: AuthUser) {
    return sendRpc(this.users, PATTERNS.users.me, { userId: user.id });
  }

  @Patch('me')
  @ApiOperation({ summary: 'Update own profile / change password' })
  updateMe(@CurrentUser() user: AuthUser, @Body() dto: UpdateMeDto) {
    return sendRpc(this.users, PATTERNS.users.updateMe, { userId: user.id, data: dto });
  }

  @Roles(Role.ADMIN)
  @Get()
  @ApiOperation({ summary: '[Admin] List users' })
  @ApiForbiddenResponse({ description: 'Not an admin' })
  findAll(@Query() query: UsersQueryDto) {
    return sendRpc(this.users, PATTERNS.users.findAll, query);
  }

  @Roles(Role.ADMIN)
  @Get(':id')
  @ApiOperation({ summary: '[Admin] Get a user' })
  @ApiForbiddenResponse({ description: 'Not an admin' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return sendRpc(this.users, PATTERNS.users.findOne, { id });
  }
}
