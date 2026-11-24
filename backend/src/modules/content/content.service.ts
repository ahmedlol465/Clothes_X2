import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { CommunityLook, TrendStyle } from '../../database/entities/content.entity';

@Injectable()
export class ContentService {
  constructor(
    @InjectRepository(TrendStyle)
    private readonly trends: Repository<TrendStyle>,
    @InjectRepository(CommunityLook)
    private readonly looks: Repository<CommunityLook>,
  ) {}

  async discover() {
    const [trends, looks] = await Promise.all([
      this.trends.find({ order: { sortOrder: 'ASC' } }),
      this.looks.find({ order: { sortOrder: 'ASC' } }),
    ]);

    return {
      trendingStyles: trends.map((row) => ({
        name: row.name,
        tag: row.tag,
        image: row.imageUrl,
      })),
      communityLooks: looks.map((row) => ({
        name: row.name,
        likes: row.likes,
        image: row.imageUrl,
      })),
    };
  }
}
