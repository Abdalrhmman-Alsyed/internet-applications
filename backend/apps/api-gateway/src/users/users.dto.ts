import { Role } from '@app/common';
import { IsEnum, IsOptional, IsString, Length, Matches, MaxLength } from 'class-validator';
import { STRONG_PASSWORD, STRONG_PASSWORD_MESSAGE } from '../auth/auth.dto';
import { PaginationQueryDto } from '../common/pagination.dto';

export class UpdateMeDto {
  @IsOptional()
  @IsString()
  @Length(2, 80)
  name?: string;

  @IsOptional()
  @Matches(/^\+?[0-9]{7,15}$/, { message: 'phone must be 7-15 digits, optionally starting with +' })
  phone?: string;

  /** Required when changing the password */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  currentPassword?: string;

  @IsOptional()
  @Matches(STRONG_PASSWORD, { message: STRONG_PASSWORD_MESSAGE })
  newPassword?: string;
}

export class UsersQueryDto extends PaginationQueryDto {
  /** Search by name or email */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @IsOptional()
  @IsEnum(Role)
  role?: Role;
}
