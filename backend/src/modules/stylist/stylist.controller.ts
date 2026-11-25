import {
  Body,
  Controller,
  Delete,
  Get,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';

import { CurrentUser } from '../../common/decorators/auth.decorators';
import { multerOptions } from '../../common/storage/storage';
import { ChatDto } from './dto/chat.dto';
import { StylistService } from './stylist.service';

@ApiTags('AI Stylist')
@ApiBearerAuth()
@Controller('ai')
export class StylistController {
  constructor(private readonly stylist: StylistService) {}

  @Post('analyze-clothing')
  analyze(
    @CurrentUser('id') userId: string,
    @Body() body: Record<string, any>,
  ) {
    return this.stylist.analyzeClothing(userId, body);
  }

  @Post('generate-outfit')
  generate(
    @CurrentUser('id') userId: string,
    @Body() body: Record<string, any>,
  ) {
    return this.stylist.generateOutfit(userId, body);
  }

  @Post('calculate-compatibility')
  compatibility(
    @CurrentUser('id') userId: string,
    @Body() body: Record<string, any>,
  ) {
    return this.stylist.calculateCompatibility(userId, body);
  }

  @Post('style-profile')
  styleProfile(@CurrentUser('id') userId: string) {
    return this.stylist.styleProfileSummary(userId);
  }

  @Post('wardrobe-gap')
  wardrobeGap(@CurrentUser('id') userId: string) {
    return this.stylist.wardrobeGap(userId);
  }

  @Post('packing-list')
  packing(
    @CurrentUser('id') userId: string,
    @Body() body: Record<string, any>,
  ) {
    return this.stylist.packingList(userId, body);
  }

  @Post('chat')
  chat(
    @CurrentUser('id') userId: string,
    @Body() body: ChatDto,
  ) {
    return this.stylist.chat(userId, body);
  }

  @Post('chat/stream')
  stream(
    @CurrentUser('id') userId: string,
    @Body() body: ChatDto,
    @Res() res: Response,
  ) {
    return this.stylist.chatStream(userId, body, res);
  }

  @Post('match-outfit')
  @ApiConsumes('application/json', 'multipart/form-data')
  @UseInterceptors(FileInterceptor('photo', multerOptions))
  match(
    @CurrentUser('id') userId: string,
    @Body() body: Record<string, any>,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.stylist.matchOutfit(userId, body, file);
  }

  @Post('remix')
  remix(
    @CurrentUser('id') userId: string,
    @Body() body: Record<string, any>,
  ) {
    return this.stylist.remix(userId, body);
  }

  @Get('style-dna')
  styleDna(@CurrentUser('id') userId: string) {
    return this.stylist.styleDna(userId);
  }

  @Get('conversations')
  conversations(
    @CurrentUser('id') userId: string,
    @Query('limit') limit?: string,
  ) {
    return this.stylist.conversations(userId, Number(limit) || 40);
  }

  @Delete('conversations')
  clear(@CurrentUser('id') userId: string) {
    return this.stylist.clearConversations(userId);
  }

  @Get('capabilities')
  capabilities(@CurrentUser('id') userId: string) {
    return this.stylist.capabilities(userId);
  }
}
