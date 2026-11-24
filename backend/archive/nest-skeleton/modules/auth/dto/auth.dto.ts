import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsOptional,
  IsString,
  Matches,
  MinLength,
} from 'class-validator';

export class RegisterDto {
  @ApiProperty({ example: 'karim@wardrobe.ai' })
  @IsEmail({}, { message: 'A valid email address is required' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  email: string;

  @ApiProperty({ example: 'Str0ngPass!', minLength: 8 })
  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters' })
  password: string;

  @ApiProperty({ example: 'Karim', required: false })
  @IsOptional()
  @IsString()
  firstName?: string;

  @ApiProperty({ example: 'Hassan', required: false })
  @IsOptional()
  @IsString()
  lastName?: string;

  @ApiProperty({ example: '+201001234567', required: false })
  @IsOptional()
  @Matches(/^\+?[0-9\s-]{6,20}$/, { message: 'Invalid phone number' })
  phone?: string;
}

export class LoginDto {
  @ApiProperty({ example: 'karim@wardrobe.ai' })
  @IsEmail()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  email: string;

  @ApiProperty({ example: 'Str0ngPass!' })
  @IsString()
  @MinLength(1)
  password: string;
}

export class RefreshDto {
  @ApiProperty({ description: 'The refresh token issued by /auth/login' })
  @IsString()
  refreshToken: string;
}

export class SocialAuthDto {
  @ApiProperty({ enum: ['google', 'apple', 'phone'] })
  @IsString()
  provider: 'google' | 'apple' | 'phone';

  @ApiProperty({ description: 'Provider id token or verified phone number' })
  @IsString()
  credential: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  firstName?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  lastName?: string;
}

export class AuthUserDto {
  @ApiProperty() id: string;
  @ApiProperty() email: string;
  @ApiProperty({ enum: ['user', 'admin'] }) role: string;
  @ApiProperty() firstName: string | null;
  @ApiProperty() lastName: string | null;
  @ApiProperty({ required: false }) avatarUrl?: string | null;
  @ApiProperty() onboardingCompleted: boolean;
  @ApiProperty() emailVerified: boolean;
  @ApiProperty({ type: 'string', format: 'date-time' }) createdAt: string;
}

export class AuthTokensDto {
  @ApiProperty() accessToken: string;
  @ApiProperty() refreshToken: string;
  @ApiProperty({ example: 900 }) expiresIn: number;
  @ApiProperty({ enum: ['Bearer'] }) tokenType: 'Bearer';
}

export class AuthResponseDto {
  @ApiProperty({ type: AuthUserDto }) user: AuthUserDto;
  @ApiProperty({ type: AuthTokensDto }) tokens: AuthTokensDto;
}

export class LogoutDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  refreshToken?: string;
}
