import { Controller, Get, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';

import { CurrentUser } from '../../common/decorators/auth.decorators';
import { CollageService } from './collage.service';

@ApiTags('Collage')
@ApiBearerAuth()
@Controller('collage')
export class CollageController {
  constructor(private readonly collage: CollageService) {}

  /** Today's recommended outfit as one merged flat-lay JPEG (cached). */
  @Get('daily')
  async daily(@CurrentUser('id') userId: string, @Res() res: Response) {
    const { bytes } = await this.collage.dailyCollage(userId);
    res.set({
      'Content-Type': 'image/jpeg',
      'Cache-Control': 'private, max-age=300',
    });
    res.send(bytes);
  }
}
