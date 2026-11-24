import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';

import { CurrentUser } from '../../common/decorators/auth.decorators';
import { multerOptions } from '../../common/storage/storage';
import { WardrobeService } from './wardrobe.service';
import {
  CreateWardrobeItemDto,
  UpdateWardrobeItemDto,
  QueryWardrobeDto,
} from './dto/create-wardrobe-item.dto';

@ApiTags('Wardrobe')
@ApiBearerAuth()
@Controller('wardrobe')
export class WardrobeController {
  constructor(private readonly wardrobe: WardrobeService) {}

  @Post('upload')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FilesInterceptor('photos', 10, multerOptions))
  upload(
    @Req() req: Request,
    @UploadedFiles() files?: Express.Multer.File[],
  ) {
    return this.wardrobe.upload(req, files);
  }

  @Get('items')
  list(
    @CurrentUser('id') userId: string,
    @Query() query: QueryWardrobeDto,
  ) {
    return this.wardrobe.list(userId, query);
  }

  @Post('items')
  create(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateWardrobeItemDto,
  ) {
    return this.wardrobe.create(userId, dto).then((item) => ({ item }));
  }

  @Post('items/batch-upload')
  batch(
    @CurrentUser('id') userId: string,
    @Body() body: Record<string, any>,
  ) {
    return this.wardrobe.batchUpload(userId, body);
  }

  @Get('collections')
  collections(@CurrentUser('id') userId: string) {
    return this.wardrobe.collections(userId);
  }

  @Get('items/:id')
  get(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return { item: this.wardrobe.find(userId, id) };
  }

  @Patch('items/:id')
  patch(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateWardrobeItemDto,
  ) {
    return this.wardrobe.patch(userId, id, dto).then((item) => ({ item }));
  }

  @Delete('items/:id')
  remove(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.wardrobe.archive(userId, id);
  }
}
