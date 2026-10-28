import { PATTERNS } from '@app/common';
import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { AuthService, RegisterPayload } from './auth.service';
import { FindUsersQuery, UpdateMePayload, UsersService } from './users.service';

@Controller()
export class UsersController {
  constructor(
    private readonly auth: AuthService,
    private readonly users: UsersService,
  ) {}

  @MessagePattern(PATTERNS.health)
  health() {
    return { service: 'users', status: 'ok' };
  }

  @MessagePattern(PATTERNS.users.register)
  register(@Payload() dto: RegisterPayload) {
    return this.auth.register(dto);
  }

  @MessagePattern(PATTERNS.users.login)
  login(@Payload() { email, password }: { email: string; password: string }) {
    return this.auth.login(email, password);
  }

  @MessagePattern(PATTERNS.users.refresh)
  refresh(@Payload() { refreshToken }: { refreshToken: string }) {
    return this.auth.refresh(refreshToken);
  }

  @MessagePattern(PATTERNS.users.logout)
  logout(@Payload() { userId }: { userId: string }) {
    return this.auth.logout(userId);
  }

  @MessagePattern(PATTERNS.users.me)
  me(@Payload() { userId }: { userId: string }) {
    return this.users.findById(userId);
  }

  @MessagePattern(PATTERNS.users.updateMe)
  updateMe(@Payload() { userId, data }: { userId: string; data: UpdateMePayload }) {
    return this.users.updateMe(userId, data);
  }

  @MessagePattern(PATTERNS.users.findAll)
  findAll(@Payload() query: FindUsersQuery) {
    return this.users.findAll(query);
  }

  @MessagePattern(PATTERNS.users.findOne)
  findOne(@Payload() { id }: { id: string }) {
    return this.users.findById(id);
  }
}
