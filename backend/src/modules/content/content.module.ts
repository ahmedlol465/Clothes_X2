import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { CommunityLook, TrendStyle } from '../../database/entities/content.entity';
import { ContentController } from './content.controller';
import { ContentService } from './content.service';

@Module({
  imports: [TypeOrmModule.forFeature([TrendStyle, CommunityLook])],
  controllers: [ContentController],
  providers: [ContentService],
})
export class ContentModule {}
