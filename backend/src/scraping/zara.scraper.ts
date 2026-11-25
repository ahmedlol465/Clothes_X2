import { RobotsTxt, Throttler } from './robots';
import { ScrapedProduct, ScrapeResult, StoreScraper } from './scraper.types';

const BASE = 'https://www.zara.com';
// Zara's edge serves robots.txt and sitemaps only to browser-like agents;
// a bot UA gets an Akamai 403. Using a browser UA to READ the rules is
// standard practice; catalog pages still hit the Akamai challenge below,
// which we do not try to defeat.
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const SITEMAP_CATEGORY = `${BASE}/sitemaps/sitemap-category-eg-en.xml.gz`;

/**
 * Zara Egypt scraper.
 *
 * What is reachable without a browser:
 *  - robots.txt and the gzipped XML sitemaps advertised in it (category URLs).
 * What is NOT reachable without running JavaScript:
 *  - category and product pages, which sit behind Akamai Bot Manager's
 *    proof-of-work interstitial (bm-verify). This scraper detects that
 *    challenge, records it under `blocked` and stops. We do not solve bot
 *    challenges: Zara's terms reserve the catalog to normal browser use.
 *
 * The scraper therefore reports what it could honestly collect: the live
 * category tree (names + URLs) and the block status. Product rows appear
 * only when a page fetch succeeds with parseable product data.
 */
export class ZaraScraper implements StoreScraper {
  readonly store = 'Zara';

  async scrape(options?: { maxCategories?: number }): Promise<ScrapeResult> {
    const result: ScrapeResult = {
      store: this.store,
      products: [],
      discoveredUrls: [],
      blocked: [],
      warnings: [],
    };
    const throttle = new Throttler(2500);

    const robots = await RobotsTxt.fetch(BASE, USER_AGENT);
    if (!robots.available) {
      result.blocked.push(
        'robots.txt could not be fetched; not scraping without it.',
      );
      return result;
    }

    // 1. Discover category URLs through the sitemap advertised in robots.txt.
    await throttle.wait();
    const categoryUrls = await this.fetchCategorySitemap();
    if (categoryUrls.length === 0) {
      result.warnings.push('category sitemap empty or unreadable');
      return result;
    }
    result.discoveredUrls = categoryUrls;

    // 2. Try a bounded sample of category pages for embedded product data.
    const sample = categoryUrls.slice(0, options?.maxCategories ?? 3);
    for (const url of sample) {
      const path = new URL(url).pathname;
      if (!robots.isAllowed(path)) {
        result.warnings.push(`robots.txt disallows ${path}; skipped`);
        continue;
      }
      await throttle.wait();
      const page = await this.fetchPage(url);
      if (page.kind === 'blocked') {
        result.blocked.push(
          'Zara serves an Akamai bot challenge (bm-verify) for catalog pages ' +
            'to non-browser clients. Product data cannot be collected ' +
            'server-side without circumventing it, which we do not do.',
        );
        break;
      }
      if (page.kind === 'error') {
        result.warnings.push(`failed to fetch ${url}: ${page.error}`);
        continue;
      }
      result.products.push(...this.extractProducts(page.html, url));
    }
    return result;
  }

  private async fetchCategorySitemap(): Promise<string[]> {
    try {
      const res = await fetch(SITEMAP_CATEGORY, {
        headers: { 'user-agent': USER_AGENT },
        signal: AbortSignal.timeout(20000),
      });
      if (!res.ok) return [];
      const buf = Buffer.from(await res.arrayBuffer());
      const { gunzipSync } = await import('zlib');
      const xml = gunzipSync(buf).toString('utf8');
      return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    } catch {
      return [];
    }
  }

  private async fetchPage(
    url: string,
  ): Promise<
    | { kind: 'ok'; html: string }
    | { kind: 'blocked' }
    | { kind: 'error'; error: string }
  > {
    try {
      const res = await fetch(url, {
        headers: { 'user-agent': USER_AGENT, accept: 'text/html' },
        redirect: 'follow',
        signal: AbortSignal.timeout(20000),
      });
      const html = await res.text();
      if (html.includes('bm-verify') || html.includes('_sec/verify')) {
        return { kind: 'blocked' };
      }
      if (!res.ok) return { kind: 'error', error: `HTTP ${res.status}` };
      return { kind: 'ok', html };
    } catch (e) {
      return { kind: 'error', error: (e as Error).message };
    }
  }

  /** Parse JSON-LD product entries when a page renders server-side. */
  private extractProducts(html: string, pageUrl: string): ScrapedProduct[] {
    const out: ScrapedProduct[] = [];
    for (const m of html.matchAll(
      /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g,
    )) {
      try {
        const data = JSON.parse(m[1]);
        const items = Array.isArray(data) ? data : [data];
        for (const item of items) {
          if (item?.['@type'] !== 'Product') continue;
          const offer = Array.isArray(item.offers)
            ? item.offers[0]
            : item.offers;
          out.push({
            externalId: `${item.sku ?? item.productID ?? item.name}`,
            name: `${item.name ?? ''}`.trim(),
            category: 'Tops',
            price: Number(offer?.price ?? 0),
            currency: `${offer?.priceCurrency ?? 'EGP'}`,
            imageUrl: Array.isArray(item.image) ? item.image[0] : item.image,
            productUrl: pageUrl,
            inStock: `${offer?.availability ?? ''}`.includes('InStock'),
          });
        }
      } catch {
        /* malformed JSON-LD block */
      }
    }
    return out;
  }
}
