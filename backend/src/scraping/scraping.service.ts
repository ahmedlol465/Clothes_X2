import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { ShoppingItem } from '../database/entities/shopping.entity';
import { ScrapeResult, StoreScraper } from './scraper.types';
import { ZaraScraper } from './zara.scraper';

/**
 * Runs store scrapers on demand and upserts what they return into
 * shopping_items, keyed on (store, externalId). Scraped rows are marked
 * source='scraper' so they stay distinguishable from seed demo data.
 *
 * Triggered manually only (CLI or admin endpoint) - never on a schedule.
 */
@Injectable()
export class ScrapingService {
  private readonly logger = new Logger(ScrapingService.name);
  private readonly scrapers: StoreScraper[] = [new ZaraScraper()];

  constructor(
    @InjectRepository(ShoppingItem)
    private readonly productRepo: Repository<ShoppingItem>,
  ) {}

  listStores(): string[] {
    return this.scrapers.map((s) => s.store);
  }

  async run(storeName: string): Promise<ScrapeResult & { upserted: number }> {
    const scraper = this.scrapers.find(
      (s) => s.store.toLowerCase() === storeName.toLowerCase(),
    );
    if (!scraper) {
      throw new Error(
        `Unknown store "${storeName}". Available: ${this.listStores().join(', ')}`,
      );
    }
    this.logger.log(`Scrape requested for ${scraper.store} (manual trigger)`);
    const result = await scraper.scrape();
    let upserted = 0;
    for (const p of result.products) {
      const existing = await this.productRepo.findOne({
        where: { store: scraper.store, externalId: p.externalId },
      });
      const row = existing ?? this.productRepo.create();
      row.store = scraper.store;
      row.source = 'scraper';
      row.externalId = p.externalId;
      row.name = p.name;
      row.category = p.category;
      row.price = p.price;
      row.currency = p.currency;
      row.originalPrice = p.originalPrice ?? null;
      row.color = p.color ?? null;
      row.style = p.style ?? null;
      row.season = p.season ?? null;
      row.sizes = p.sizes ?? null;
      row.imageUrl = p.imageUrl ?? null;
      row.productUrl = p.productUrl ?? null;
      row.inStock = p.inStock ?? true;
      row.scrapedAt = new Date();
      await this.productRepo.save(row);
      upserted++;
    }
    this.logger.log(
      `Scrape done for ${scraper.store}: ${upserted} upserted, ` +
        `${result.blocked.length} blockers, ${result.warnings.length} warnings`,
    );
    return { ...result, upserted };
  }
}
