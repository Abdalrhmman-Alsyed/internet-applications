import { AuthUser, PATTERNS, sendRpc, USERS_SERVICE } from '@app/common';
import { Body, Controller, HttpCode, Inject, Post } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser, Public } from '../common/decorators';
import { AUTH_RATE_LIMIT } from '../health/health.controller';
import { LoginDto, RefreshDto, RegisterDto } from './auth.dto';

/** Stricter rate limit on credential endpoints (per IP, per minute). */
const AUTH_LIMIT = { default: { limit: AUTH_RATE_LIMIT, ttl: 60_000 } };

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(@Inject(USERS_SERVICE) private readonly users: ClientProxy) {}

  @Public()
  @Throttle(AUTH_LIMIT)
  @Post('register')
  @ApiOperation({ summary: 'Register a new customer account' })
  @ApiResponse({ status: 201, description: 'Account created, tokens returned' })
  @ApiResponse({ status: 409, description: 'Email already registered' })
  register(@Body() dto: RegisterDto) {
    return sendRpc(this.users, PATTERNS.users.register, dto);
  }

  @Public()
  @Throttle(AUTH_LIMIT)
  @Post('login')
  @HttpCode(200)
  @ApiOperation({ summary: 'Log in (account locks for 15 min after 5 failed attempts)' })
  @ApiResponse({ status: 401, description: 'Invalid email or password' })
  @ApiResponse({ status: 423, description: 'Account temporarily locked' })
  @ApiResponse({ status: 429, description: 'Too many requests from this IP' })
  login(@Body() dto: LoginDto) {
    return sendRpc(this.users, PATTERNS.users.login, dto);
  }

  @Public()
  @Throttle(AUTH_LIMIT)
  @Post('refresh')
  @HttpCode(200)
  @ApiOperation({ summary: 'Exchange a refresh token for a new token pair (rotation)' })
  refresh(@Body() dto: RefreshDto) {
    return sendRpc(this.users, PATTERNS.users.refresh, dto);
  }

  @ApiBearerAuth()
  @Post('logout')
  @HttpCode(200)
  @ApiOperation({ summary: 'Revoke the current refresh token' })
  logout(@CurrentUser() user: AuthUser) {
    return sendRpc(this.users, PATTERNS.users.logout, { userId: user.id });
  }
}
