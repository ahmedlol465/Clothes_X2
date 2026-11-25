import {
  Body,
  Controller,
  Get,
  Patch,
  Post,
  Req,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';

import { CurrentUser } from '../../common/decorators/auth.decorators';
import { multerOptions } from '../../common/storage/storage';
import { UsersService } from './users.service';

@ApiTags('Users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('me')
  async me(@CurrentUser('id') userId: string) {
    return { user: await this.users.profile(userId) };
  }

  @Patch('me')
  update(
    @CurrentUser('id') userId: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.users.update(userId, body).then((user) => ({ user }));
  }

  @Post('me/avatar')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('photo', multerOptions))
  async avatar(
    @CurrentUser('id') userId: string,
    @Req() req: Request,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return { user: await this.users.updateAvatar(userId, req, file) };
  }

  @Get('me/style-profile')
  async styleProfile(@CurrentUser('id') userId: string) {
    return { styleProfile: await this.users.styleProfile(userId) };
  }

  @Patch('me/style-profile')
  updateStyleProfile(
    @CurrentUser('id') userId: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.users.updateStyleProfile(userId, body);
  }
}
