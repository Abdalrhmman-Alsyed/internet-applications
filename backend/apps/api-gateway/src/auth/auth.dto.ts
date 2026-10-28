import { Transform } from 'class-transformer';
import { IsEmail, IsJWT, IsNotEmpty, IsOptional, IsString, Length, Matches, MaxLength } from 'class-validator';

export const STRONG_PASSWORD = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,64}$/;
export const STRONG_PASSWORD_MESSAGE =
  'password must be 8-64 characters and contain an uppercase letter, a lowercase letter and a digit';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class RegisterDto {
  /** @example customer@shop.local */
  @Transform(trim)
  @IsEmail()
  @MaxLength(254)
  email!: string;

  /** @example Customer@123 */
  @Matches(STRONG_PASSWORD, { message: STRONG_PASSWORD_MESSAGE })
  password!: string;

  /** @example Ahmad Ali */
  @Transform(trim)
  @IsString()
  @Length(2, 80)
  name!: string;

  /** @example +963912345678 */
  @IsOptional()
  @Matches(/^\+?[0-9]{7,15}$/, { message: 'phone must be 7-15 digits, optionally starting with +' })
  phone?: string;
}

export class LoginDto {
  /** @example admin@shop.local */
  @Transform(trim)
  @IsEmail()
  email!: string;

  /** @example Admin@12345 */
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  password!: string;
}

export class RefreshDto {
  @IsJWT()
  refreshToken!: string;
}
