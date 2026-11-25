/** A product row normalized by a store scraper, ready for upsert into
 * shopping_items keyed on (store, externalId). */
export interface ScrapedProduct {
  externalId: string;
  name: string;
  category: string;
  price: number;
  currency: string;
  originalPrice?: number | null;
  color?: string | null;
  style?: string | null;
  season?: string | null;
  sizes?: string[] | null;
  imageUrl?: string | null;
  productUrl?: string | null;
  inStock?: boolean;
}

export interface ScrapeResult {
  store: string;
  /** Products successfully fetched and normalized. */
  products: ScrapedProduct[];
  /** Category/listing URLs discovered (e.g. via the store sitemap). */
  discoveredUrls: string[];
  /** Honest blockers hit along the way (bot protection, robots.txt, terms). */
  blocked: string[];
  warnings: string[];
}

/**
 * One implementation per store. Scrapers must:
 *  - check robots.txt before fetching anything (see robots.ts);
 *  - throttle requests (see Throttler);
 *  - never work around bot protection: when a store answers with a bot
 *    challenge, record it in `blocked` and stop instead of escalating.
 */
export interface StoreScraper {
  readonly store: string;
  scrape(options?: { maxCategories?: number }): Promise<ScrapeResult>;
}
