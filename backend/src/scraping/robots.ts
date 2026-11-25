/**
 * Minimal robots.txt fetch + allow check. Fails closed for the paths we care
 * about: when robots.txt cannot be fetched at all, the scraper must not run.
 */
export class RobotsTxt {
  private rules: { disallow: string[] } = { disallow: [] };

  private constructor(
    private readonly baseUrl: string,
    private readonly fetched: boolean,
  ) {}

  static async fetch(baseUrl: string, userAgent: string): Promise<RobotsTxt> {
    const r = new RobotsTxt(baseUrl.replace(/\/$/, ''), false);
    try {
      const res = await fetch(`${r.baseUrl}/robots.txt`, {
        headers: { 'user-agent': userAgent },
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) return r;
      const text = await res.text();
      r.rules = RobotsTxt.parse(text);
      (r as any).fetched = true;
    } catch {
      /* leave fetched=false */
    }
    return r;
  }

  static parse(text: string): { disallow: string[] } {
    const disallow: string[] = [];
    let applies = false;
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.replace(/#.*$/, '').trim();
      if (!line) continue;
      const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
      if (!m) continue;
      const field = m[1].toLowerCase();
      const value = m[2].trim();
      if (field === 'user-agent') {
        applies = value === '*' || value.toLowerCase().includes('smartwardrobe');
      } else if (applies && field === 'disallow' && value) {
        disallow.push(value);
      }
    }
    return { disallow };
  }

  get available(): boolean {
    return this.fetched;
  }

  /** robots.txt pattern match: `*` wildcard and `$` end-anchor. */
  isAllowed(path: string): boolean {
    if (!this.fetched) return false;
    for (const rule of this.rules.disallow) {
      const anchored = rule.endsWith('$');
      const pattern = (anchored ? rule.slice(0, -1) : rule)
        .split('*')
        .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
        .join('.*');
      const re = new RegExp(`^${pattern}${anchored ? '$' : ''}`);
      if (re.test(path)) return false;
    }
    return true;
  }
}

/** Fixed-delay throttle so a scraper never fires requests back to back. */
export class Throttler {
  constructor(private readonly minDelayMs = 2000) {}
  private last = 0;
  async wait(): Promise<void> {
    const now = Date.now();
    const gap = now - this.last;
    if (gap < this.minDelayMs) {
      await new Promise((r) => setTimeout(r, this.minDelayMs - gap));
    }
    this.last = Date.now();
  }
}
