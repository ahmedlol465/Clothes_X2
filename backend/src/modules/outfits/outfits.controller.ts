import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../common/decorators/auth.decorators';
import { OutfitsService } from './outfits.service';
import { CreateOutfitDto } from './dto/create-outfit.dto';

@ApiTags('Outfits')
@ApiBearerAuth()
@Controller('outfits')
export class OutfitsController {
  constructor(private readonly outfits: OutfitsService) {}

  @Get('recommended')
  recommended(
    @CurrentUser('id') userId: string,
    @Query() query: Record<string, unknown>,
  ) {
    return this.outfits.recommended(userId, query);
  }

  @Get()
  list(
    @CurrentUser('id') userId: string,
    @Query() query: Record<string, unknown>,
  ) {
    return this.outfits.list(userId, query);
  }

  @Post()
  create(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateOutfitDto,
  ) {
    return this.outfits.create(userId, dto);
  }

  @Get(':id')
  get(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.outfits.get(userId, id);
  }

  @Patch(':id')
  patch(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.outfits.patch(userId, id, body);
  }

  @Delete(':id')
  remove(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.outfits.remove(userId, id);
  }

  @Post(':id/favorite')
  favorite(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.outfits.favorite(userId, id);
  }

  @Post(':id/feedback')
  feedback(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body() body: Record<string, any>,
  ) {
    return this.outfits.feedback(userId, id, body);
  }
}
