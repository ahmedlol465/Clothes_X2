import { Controller, Get, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';

import { CurrentUser } from '../../common/decorators/auth.decorators';
import { TryonService } from './tryon.service';

@ApiTags('TryOn')
@ApiBearerAuth()
@Controller('tryon')
export class TryonController {
  constructor(private readonly tryon: TryonService) {}

  /**
   * Today's recommended outfit rendered on a person by Cloudflare
   * Workers AI, cached per outfit. Falls back to the local flat-lay
   * collage when the AI path is unavailable; `X-Tryon-Source` says
   * which one was served.
   */
  @Get('daily')
  async daily(
    @CurrentUser('id') userId: string,
    @Res() res: Response,
    @Query('occasion') occasion?: string,
  ) {
    const { bytes, source } = await this.tryon.dailyTryOn(userId, { occasion });
    res.set({
      'Content-Type': 'image/jpeg',
      'Cache-Control': 'private, max-age=300',
      'X-Tryon-Source': source,
    });
    res.send(bytes);
  }
}
