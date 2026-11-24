import {
  daysSinceWorn,
  freshnessOf,
  freshnessOfItems,
  applyFreshnessRotation,
} from './freshness';

const NOW = new Date('2026-11-25T12:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86400000);

describe('daysSinceWorn / freshnessOf', () => {
  it('never-worn pieces get the maximum freshness', () => {
    expect(daysSinceWorn({ lastWornAt: null }, NOW)).toBe(999);
    expect(freshnessOf({ lastWornAt: null }, NOW)).toBe(100);
  });

  it('a piece worn today has freshness 0', () => {
    expect(freshnessOf({ lastWornAt: NOW }, NOW)).toBe(0);
  });

  it('scales down 10 points per day under 10 days', () => {
    expect(freshnessOf({ lastWornAt: daysAgo(5) }, NOW)).toBe(50);
    expect(freshnessOf({ lastWornAt: daysAgo(10) }, NOW)).toBe(100);
  });

  it('accepts date strings from JSON payloads', () => {
    expect(freshnessOf({ lastWornAt: daysAgo(3).toISOString() }, NOW)).toBe(30);
  });

  it('stays neutral (60) when the date cannot be parsed', () => {
    expect(freshnessOf({ lastWornAt: 'not-a-date' }, NOW)).toBe(60);
  });
});

describe('freshnessOfItems', () => {
  it('ignores shoes and belts when core slots are present', () => {
    const items = [
      { category: 'Tops', lastWornAt: null }, // top → 100
      { category: 'Bottoms', lastWornAt: NOW }, // bottom → 0
      { category: 'Shoes', lastWornAt: NOW }, // footwear, excluded
    ];
    expect(freshnessOfItems(items, NOW)).toBe(50);
  });

  it('falls back to the whole outfit when no core slot exists', () => {
    const items = [{ category: 'Shoes', lastWornAt: NOW }];
    expect(freshnessOfItems(items, NOW)).toBe(0);
  });
});

describe('applyFreshnessRotation', () => {
  const item = (category: string, worn: Date | null) => ({ category, lastWornAt: worn });

  it('promotes outfits built from never-worn pieces over equally-matching worn ones', () => {
    const map = new Map([
      ['stale-top', item('Tops', NOW)],
      ['stale-bottom', item('Bottoms', NOW)],
      ['fresh-top', item('Tops', null)],
      ['fresh-bottom', item('Bottoms', null)],
    ]);
    const ranked = applyFreshnessRotation(
      [
        { id: 'worn', match: 80, itemIds: ['stale-top', 'stale-bottom'] },
        { id: 'fresh', match: 78, itemIds: ['fresh-top', 'fresh-bottom'] },
      ],
      map,
      0.5,
      NOW,
    );
    expect(ranked.map((o) => o.id)).toEqual(['fresh', 'worn']);
  });

  it('keeps a clearly better match ahead despite rotation pressure', () => {
    const map = new Map([
      ['stale-top', item('Tops', NOW)],
      ['stale-bottom', item('Bottoms', NOW)],
      ['fresh-top', item('Tops', null)],
      ['fresh-bottom', item('Bottoms', null)],
    ]);
    const ranked = applyFreshnessRotation(
      [
        { id: 'worn', match: 95, itemIds: ['stale-top', 'stale-bottom'] },
        { id: 'fresh', match: 70, itemIds: ['fresh-top', 'fresh-bottom'] },
      ],
      map,
      0.1,
      NOW,
    );
    expect(ranked[0].id).toBe('worn');
  });

  it('is deterministic for identical scores (stable original order)', () => {
    const map = new Map([['a', item('Tops', null)]]);
    const ranked = applyFreshnessRotation(
      [
        { id: 'one', match: 80, itemIds: ['a'] },
        { id: 'two', match: 80, itemIds: ['a'] },
      ],
      map,
      0.1,
      NOW,
    );
    expect(ranked.map((o) => o.id)).toEqual(['one', 'two']);
  });

  it('does not mutate the input array', () => {
    const input = [
      { id: 'one', match: 90, itemIds: [] },
      { id: 'two', match: 10, itemIds: [] },
    ];
    applyFreshnessRotation(input, new Map());
    expect(input.map((o) => o.id)).toEqual(['one', 'two']);
  });
});
