import { BadRequestException, Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { CurrentUser, Public } from '../../common/decorators/auth.decorators';
import { AuthService } from './auth.service';
import {
  AuthResponseDto,
  LoginDto,
  LogoutDto,
  RefreshDto,
  RegisterDto,
  SocialAuthDto,
} from './dto/auth.dto';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('register')
  @ApiOperation({ summary: 'Create an account (section 8.1 Auth)' })
  @ApiBody({ type: RegisterDto })
  @ApiOkResponse({ type: AuthResponseDto })
  register(@Body() dto: RegisterDto) {
    return this.auth.register(dto);
  }

  @Public()
  @Get('google/config')
  @ApiOperation({ summary: 'Whether Google sign-in is configured (no auth)' })
  googleConfig() {
    return this.auth.googleClientStatus();
  }

  @Public()
  @Post('google')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Sign in with a Google ID token' })
  google(@Body() body: { idToken?: string }) {
    if (!body?.idToken || typeof body.idToken !== 'string') {
      throw new BadRequestException('idToken is required.');
    }
    return this.auth.googleLogin(body.idToken);
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Exchange email + password for tokens' })
  @ApiOkResponse({ type: AuthResponseDto })
  @ApiUnauthorizedResponse({ description: 'Incorrect email or password' })
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto);
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rotate an access token using a refresh token' })
  @ApiOkResponse({ type: AuthResponseDto })
  refresh(@Body() dto: RefreshDto) {
    return this.auth.refresh(dto.refreshToken);
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Invalidate every outstanding session for the caller' })
  logout(@CurrentUser('id') userId: string, @Body() dto: LogoutDto) {
    return this.auth.logout(userId, dto?.refreshToken);
  }

  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Echo the authenticated principal' })
  me(@CurrentUser() user: any) {
    return user;
  }
}
