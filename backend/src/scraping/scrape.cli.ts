import 'reflect-metadata';
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { ScrapingService } from './scraping.service';

/**
 * Manual scraper trigger: `npm run scrape -- zara`.
 * Prints an honest summary: what was collected, what was blocked and why.
 */
async function main() {
  const store = process.argv[2];
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'error', 'warn'],
  });
  try {
    const scraping = app.get(ScrapingService);
    if (!store) {
      console.log(`Available stores: ${scraping.listStores().join(', ')}`);
      console.log('Usage: npm run scrape -- <store>');
      return;
    }
    const result = await scraping.run(store);
    console.log(`\n=== ${result.store} scrape result ===`);
    console.log(`Products upserted: ${result.upserted}`);
    console.log(`Category URLs discovered: ${result.discoveredUrls.length}`);
    for (const b of result.blocked) console.log(`BLOCKED: ${b}`);
    for (const w of result.warnings) console.log(`warning: ${w}`);
  } finally {
    await app.close();
  }
}

main().catch((e) => {
  console.error(`Scrape failed: ${(e as Error).message}`);
  process.exit(1);
});
