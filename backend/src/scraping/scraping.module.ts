import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ShoppingItem } from '../database/entities/shopping.entity';
import { ScrapingService } from './scraping.service';

@Module({
  imports: [TypeOrmModule.forFeature([ShoppingItem])],
  providers: [ScrapingService],
  exports: [ScrapingService],
})
export class ScrapingModule {}
