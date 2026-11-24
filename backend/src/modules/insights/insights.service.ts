import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import { StyleProfile } from '../../database/entities/identity.entity';
import { Wardrobe, WardrobeItem } from '../../database/entities/wardrobe.entity';

const SEGMENT_COLORS = ['#1E1C1A', '#A88B6A', '#C9B79C', '#D9D4CC'];

const COLOR_HEX: Record<string, string> = {
  black: '#1E1C1A',
  white: '#FFFFFF',
  blue: '#3D5A80',
  navy: '#1F2A44',
  beige: '#E0CDAF',
  tan: '#C8A06A',
  brown: '#6B4A2F',
  grey: '#8C8C8C',
  gray: '#8C8C8C',
  charcoal: '#3A3A3A',
  indigo: '#2B3A55',
  green: '#4F6F52',
  multicolor: '#B58B6A',
};

const CATEGORY_ICONS: Record<string, string> = {
  Tops: 'shirt',
  Bottoms: 'circleX',
  Shoes: 'shoe',
  Outerwear: 'jacket',
  Accessories: 'watch',
};

type Counted = { label: string; count: number };

@Injectable()
export class InsightsService {
  constructor(
    @InjectRepository(StyleProfile)
    private readonly profiles: Repository<StyleProfile>,
    @InjectRepository(Wardrobe)
    private readonly wardrobes: Repository<Wardrobe>,
    @InjectRepository(WardrobeItem)
    private readonly items: Repository<WardrobeItem>,
  ) {}

  async styleDna(userId: string) {
    const [profile, wardrobeItems] = await Promise.all([
      this.profiles.findOne({ where: { userId } }),
      this.userItems(userId),
    ]);

    const dimensions = (profile?.dimensions ?? {}) as Record<string, unknown>;
    const storedSegments = Array.isArray(dimensions.segments)
      ? (dimensions.segments as Array<{ label?: string; share?: number }>)
      : [];
    const segments = storedSegments.length
      ? storedSegments.map((row, index) => ({
          label: String(row.label ?? 'Style'),
          share: Number(row.share ?? 0),
          color: SEGMENT_COLORS[index % SEGMENT_COLORS.length],
        }))
      : this.computeSegments(wardrobeItems);

    const colors = profile?.palette?.length
      ? profile.palette.map((row) => ({
          name: row.name,
          value: row.hex,
          count: row.count,
        }))
      : this.computeColors(wardrobeItems);

    const categories = profile?.categoryMix?.length
      ? profile.categoryMix.map((row) => ({
          name: row.name,
          icon: CATEGORY_ICONS[row.name] ?? 'shirt',
          count: row.count,
        }))
      : this.computeCategories(wardrobeItems);

    const evolution = profile?.evolution ?? [];

    return {
      segments,
      colors,
      categories,
      evolution: evolution.map((row) => Number(row.score ?? 0)),
      evolutionMonths: evolution.map((row) => String(row.month ?? '')),
      confidence: Number(profile?.overallConfidence ?? 0),
      archetype: profile?.archetype ?? null,
    };
  }

  private async userItems(userId: string): Promise<WardrobeItem[]> {
    const wardrobes = await this.wardrobes.find({ where: { userId } });
    if (wardrobes.length === 0) return [];
    return this.items.find({
      where: {
        wardrobeId: In(wardrobes.map((row) => row.id)),
        status: 'active',
      },
    });
  }

  private computeSegments(items: WardrobeItem[]) {
    const counts = countBy(items.map((row) => row.style ?? 'Casual'));
    const total = counts.reduce((sum, row) => sum + row.count, 0) || 1;
    return counts.slice(0, 4).map((row, index) => ({
      label: row.label,
      share: Math.round((row.count / total) * 100),
      color: SEGMENT_COLORS[index % SEGMENT_COLORS.length],
    }));
  }

  private computeColors(items: WardrobeItem[]) {
    return countBy(items.map((row) => row.color ?? 'Neutral'))
      .slice(0, 5)
      .map((row) => ({
        name: row.label,
        value: COLOR_HEX[row.label.toLowerCase()] ?? '#B58B6A',
        count: row.count,
      }));
  }

  private computeCategories(items: WardrobeItem[]) {
    return countBy(items.map((row) => row.category ?? 'Other')).map((row) => ({
      name: row.label,
      icon: CATEGORY_ICONS[row.label] ?? 'shirt',
      count: row.count,
    }));
  }
}

function countBy(values: string[]): Counted[] {
  const map = new Map<string, number>();
  for (const value of values) map.set(value, (map.get(value) ?? 0) + 1);
  return [...map.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count);
}
