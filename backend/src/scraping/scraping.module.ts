import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ShoppingItem } from '../database/entities/shopping.entity';
import { ScrapingService, STORE_SCRAPERS } from './scraping.service';
import { StoreScraper } from './scraper.types';
import { ZaraScraper } from './zara.scraper';
import {
  CaliceScraper,
  DocklandScraper,
  LuxorApparelScraper,
  OverpoweredScraper,
  PulpScraper,
  WaveScraper,
} from './shopify.scraper';

/** Adding a store = one scraper class plus one entry here. */
const SCRAPER_CLASSES: (new () => StoreScraper)[] = [
  ZaraScraper,
  WaveScraper,
  DocklandScraper,
  LuxorApparelScraper,
  PulpScraper,
  CaliceScraper,
  OverpoweredScraper,
];

@Module({
  imports: [TypeOrmModule.forFeature([ShoppingItem])],
  providers: [
    ScrapingService,
    {
      provide: STORE_SCRAPERS,
      useFactory: () => SCRAPER_CLASSES.map((cls) => new cls()),
    },
  ],
  exports: [ScrapingService],
})
export class ScrapingModule {}
