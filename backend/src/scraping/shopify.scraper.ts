import { RobotsTxt, Throttler } from './robots';
import { ScrapedProduct, ScrapeResult, StoreScraper } from './scraper.types';

/**
 * Generic scraper for Shopify storefronts. Shopify exposes a public,
 * robots-permitted product feed at /products.json (paginated, 250/page).
 * This is a documented storefront feature, not a private API: no login, no
 * bot challenge, no terms workaround. Each store is a tiny subclass naming
 * its domain, display name and currency.
 *
 * Requests are throttled (2.5s) and capped at `maxPages` pages per run.
 */
export abstract class ShopifyScraper implements StoreScraper {
  abstract readonly store: string;
  protected abstract readonly baseUrl: string;
  protected abstract readonly currency: string;
  protected readonly maxPages = 3;

  async scrape(): Promise<ScrapeResult> {
    const result: ScrapeResult = {
      store: this.store,
      products: [],
      discoveredUrls: [],
      blocked: [],
      warnings: [],
    };
    const throttle = new Throttler(2500);

    const robots = await RobotsTxt.fetch(this.baseUrl, '*');
    if (!robots.available) {
      result.blocked.push('robots.txt could not be fetched; not scraping.');
      return result;
    }
    if (!robots.isAllowed('/products.json')) {
      result.blocked.push('robots.txt disallows /products.json');
      return result;
    }

    for (let page = 1; page <= this.maxPages; page++) {
      await throttle.wait();
      const url = `${this.baseUrl}/products.json?limit=250&page=${page}`;
      let rows: any[];
      try {
        const res = await fetch(url, {
          headers: { 'user-agent': 'Mozilla/5.0', accept: 'application/json' },
          signal: AbortSignal.timeout(20000),
        });
        if (!res.ok) {
          result.warnings.push(`page ${page}: HTTP ${res.status}`);
          break;
        }
        const data = (await res.json()) as { products?: any[] };
        rows = data.products ?? [];
      } catch (e) {
        result.warnings.push(`page ${page}: ${(e as Error).message}`);
        break;
      }
      if (rows.length === 0) break;
      result.discoveredUrls.push(url);
      for (const raw of rows) {
        const mapped = this.mapProduct(raw);
        if (mapped) result.products.push(mapped);
      }
      if (rows.length < 250) break;
    }
    return result;
  }

  private mapProduct(raw: any): ScrapedProduct | null {
    const variants: any[] = raw.variants ?? [];
    const available = variants.filter((v) => v.available);
    if (!variants.length || !available.length) return null;
    const prices = available.map((v) => Number(v.price)).filter(Number.isFinite);
    if (!prices.length) return null;
    const price = Math.min(...prices);
    const compareAt = available
      .map((v) => Number(v.compare_at_price))
      .filter((n) => Number.isFinite(n) && n > price);
    const images: any[] = raw.images ?? [];
    const sizes = ShopifyScraper.optionValues(raw, 'size');
    const colorOpt = ShopifyScraper.optionValues(raw, 'color');
    const titleColor = ShopifyScraper.colorFromTitle(`${raw.title ?? ''}`);
    return {
      externalId: `${raw.id}`,
      name: `${raw.title ?? ''}`.replace(/\s+-\s+[A-Z]+$/, '').trim(),
      category: ShopifyScraper.mapCategory(
        `${raw.product_type ?? ''} ${raw.title ?? ''}`,
      ),
      price,
      currency: this.currency,
      originalPrice: compareAt.length ? Math.min(...compareAt) : null,
      color: colorOpt[0] ?? titleColor,
      style: null,
      season: null,
      sizes: sizes.length ? sizes : null,
      imageUrl: images[0]?.src ?? null,
      productUrl: `${this.baseUrl}/products/${raw.handle}`,
      inStock: true,
    };
  }

  private static optionValues(raw: any, name: string): string[] {
    for (const opt of raw.options ?? []) {
      if (`${opt.name ?? ''}`.toLowerCase() === name) {
        return (opt.values ?? []).map((v: any) => `${v}`);
      }
    }
    return [];
  }

  /** "Zip Jacket - CHARCOAL" -> "Charcoal" */
  private static colorFromTitle(title: string): string | null {
    const m = title.match(/\s-\s([A-Za-z ]+)$/);
    if (!m) return null;
    const c = m[1].trim().toLowerCase();
    return c.charAt(0).toUpperCase() + c.slice(1);
  }

  /** Map store product types/titles onto the app's category vocabulary. */
  private static mapCategory(text: string): string {
    const t = text.toLowerCase();
    if (/(jacket|coat|blazer|parka|puffer|windbreaker|varsity|overshirt)/.test(t)) {
      return 'Outerwear';
    }
    if (/(shoe|sneaker|boot|loafer|sandal|slipper|footwear)/.test(t)) {
      return 'Shoes';
    }
    if (/(pant|trouser|jean|sweatpant|jogger|short|chino|cargo|bottom)/.test(t)) {
      return 'Bottoms';
    }
    if (/(belt|cap|hat|beanie|bag|scarf|sock|accessor|wallet|sunglasses)/.test(t)) {
      return 'Accessories';
    }
    return 'Tops';
  }
}

export class WaveScraper extends ShopifyScraper {
  readonly store = 'Wave';
  protected readonly baseUrl = 'https://waveeg.com';
  protected readonly currency = 'EGP';
}

export class DocklandScraper extends ShopifyScraper {
  readonly store = 'Dockland';
  protected readonly baseUrl = 'https://www.dockland.com.eg';
  protected readonly currency = 'EGP';
}

export class LuxorApparelScraper extends ShopifyScraper {
  readonly store = 'Luxor Apparel';
  protected readonly baseUrl = 'https://luxorapparel.com';
  protected readonly currency = 'AUD'; // storefront currency, verified live
}

export class PulpScraper extends ShopifyScraper {
  readonly store = 'Pulp';
  protected readonly baseUrl = 'https://pulpeg.com';
  protected readonly currency = 'EGP';
}

export class CaliceScraper extends ShopifyScraper {
  readonly store = 'Calice';
  protected readonly baseUrl = 'https://calice-clothing.com';
  protected readonly currency = 'USD'; // storefront currency, verified live
}

export class OverpoweredScraper extends ShopifyScraper {
  readonly store = 'Overpowered';
  protected readonly baseUrl = 'https://overpowered.store';
  protected readonly currency = 'EGP';
}

export class CloudClothingScraper extends ShopifyScraper {
  readonly store = 'Cloud Clothing';
  protected readonly baseUrl = 'https://cloud-clothing.co';
  protected readonly currency = 'EGP';
}

export class GoNativeScraper extends ShopifyScraper {
  readonly store = 'GoNative';
  protected readonly baseUrl = 'https://gonative.eg';
  protected readonly currency = 'EGP';
}

export class OnyuScraper extends ShopifyScraper {
  readonly store = 'ONYU';
  protected readonly baseUrl = 'https://onyuclothing.com';
  protected readonly currency = 'EGP';
}

export class VevaceScraper extends ShopifyScraper {
  readonly store = 'Vevace';
  protected readonly baseUrl = 'https://vevace.co';
  protected readonly currency = 'EGP';
}
