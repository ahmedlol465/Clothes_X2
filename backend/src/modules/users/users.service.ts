import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Request } from 'express';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as fs from 'node:fs';

import {
  profilePayload,
  readStyleProfile,
  writeStyleProfile,
} from '../../common/legacy/legacy-style';
import { LegacyUser } from '../../common/legacy/legacy.types';
import {
  isOwnStorageUrl,
  storagePathOf,
  storageUrl,
} from '../../common/storage/storage';
import { User } from '../../database/entities/identity.entity';
import { StyleProfile } from '../../database/entities/identity.entity';

function toLegacyUser(user: User, styleProfile: StyleProfile | null): LegacyUser {
  const dimensions = (styleProfile?.dimensions ?? {}) as Record<string, unknown>;
  const rawSizes = (dimensions.sizes as Record<string, unknown> | undefined) ?? {};
  return {
    id: user.id,
    name: user.email.split('@')[0],
    email: user.email,
    passwordHash: user.passwordHash ?? null,
    createdAt: user.createdAt ? user.createdAt.toISOString() : new Date().toISOString(),
    avatarUrl: user.avatarUrl ?? null,
    styleProfile: {
      favoriteColors: Array.isArray(dimensions.favoriteColors) ? dimensions.favoriteColors : [],
      preferredStyles: Array.isArray(dimensions.preferredStyles) ? dimensions.preferredStyles : [],
      avoidedColors: Array.isArray(dimensions.avoidedColors) ? dimensions.avoidedColors : [],
      heightCm: dimensions.heightCm ?? null,
      weightKg: dimensions.weightKg ?? null,
      fitPreference: dimensions.fitPreference ?? 'regular',
      sizes: {
        top: rawSizes.top ?? null,
        bottom: rawSizes.bottom ?? null,
        shoe: rawSizes.shoe ?? null,
      },
    },
    tokenVersion: user.tokenVersion ?? 0,
    role: user.role ?? 'user',
  } as LegacyUser;
}

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @InjectRepository(StyleProfile)
    private readonly styleProfileRepo: Repository<StyleProfile>,
  ) {}

  private async requireUserWithProfile(userId: string): Promise<[User, StyleProfile | null]> {
    const user = await this.userRepo.findOne({
      where: { id: userId },
      relations: { styleProfile: true },
    });
    if (!user) throw new NotFoundException('User not found.');
    return [user, user.styleProfile ?? null];
  }

  async profile(userId: string) {
    const [user, styleProfile] = await this.requireUserWithProfile(userId);
    return profilePayload(toLegacyUser(user, styleProfile));
  }

  async update(userId: string, body: Record<string, unknown>) {
    const [user, styleProfile] = await this.requireUserWithProfile(userId);
    const b = body || {};

    if (b.name !== undefined) {
      const name = String(b.name).trim().slice(0, 80);
      if (!name) throw new BadRequestException('name cannot be empty.');
      user.name = name;
    }
    if (b.avatarUrl !== undefined) {
      const avatar = b.avatarUrl == null ? null : String(b.avatarUrl).trim().slice(0, 500);
      user.avatarUrl = avatar && isOwnStorageUrl(avatar) ? avatar : null;
    }

    await this.userRepo.save(user);
    return profilePayload(toLegacyUser(user, styleProfile));
  }

  async updateAvatar(userId: string, req: Request, file?: Express.Multer.File) {
    const [user, styleProfile] = await this.requireUserWithProfile(userId);
    if (!file) throw new BadRequestException('Attach an image as photo.');

    const previous = user.avatarUrl;
    user.avatarUrl = storageUrl(req, file.filename);
    await this.userRepo.save(user);

    if (previous && previous !== user.avatarUrl) {
      const old = storagePathOf(previous);
      if (old) {
        try {
          fs.unlinkSync(old);
        } catch {
          /* a stale file is harmless */
        }
      }
    }

    return profilePayload(toLegacyUser(user, styleProfile));
  }

  async styleProfile(userId: string) {
    const [user, styleProfile] = await this.requireUserWithProfile(userId);
    return readStyleProfile(toLegacyUser(user, styleProfile));
  }

  async updateStyleProfile(userId: string, body: Record<string, unknown>) {
    const [user, styleProfile] = await this.requireUserWithProfile(userId);
    const legacy = toLegacyUser(user, styleProfile);
    const next = writeStyleProfile(legacy, body || {});

    let sp = styleProfile;
    if (!sp) {
      sp = this.styleProfileRepo.create({ userId });
    }
    sp.dimensions = {
      favoriteColors: next.favoriteColors?.length ?? 0,
      preferredStyles: next.preferredStyles?.length ?? 0,
      avoidedColors: next.avoidedColors?.length ?? 0,
      heightCm: next.heightCm ?? 0,
      weightKg: next.weightKg ?? 0,
      fitPreference: Number(next.fitPreference === 'regular' ? 1 : 0),
      sizes: Object.entries(next.sizes).length,
    } as unknown as Record<string, number>;
    await this.styleProfileRepo.save(sp);

    return { styleProfile: next, user: profilePayload(toLegacyUser(user, sp)) };
  }
}
