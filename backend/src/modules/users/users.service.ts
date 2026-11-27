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
    name: user.name ?? user.email.split('@')[0],
    email: user.email,
    passwordHash: user.passwordHash ?? null,
    createdAt: user.createdAt ? user.createdAt.toISOString() : new Date().toISOString(),
    avatarUrl: user.avatarUrl ?? null,
    styleProfile: {
      gender: dimensions.gender === 'male' || dimensions.gender === 'female' ? dimensions.gender : null,
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
    const dimensions = (styleProfile?.dimensions ?? {}) as Record<string, unknown>;
    return {
      ...readStyleProfile(toLegacyUser(user, styleProfile)),
      onboarding: dimensions.onboarding ?? null,
    };
  }

  /**
   * The 3-tap onboarding answers ("what does a usual day look like", "how
   * often are formal days"). Stored on the style profile, and the engine
   * learns from them: the usual day becomes the default occasion on the
   * home Today row, and frequent formal days nudge formalityBias upward.
   */
  async saveOnboarding(userId: string, body: Record<string, unknown>) {
    const usualDay = `${body.usualDay ?? ''}`.toLowerCase();
    const formalDays = `${body.formalDays ?? ''}`.toLowerCase();
    if (!['university', 'office', 'remote', 'mixed'].includes(usualDay)) {
      throw new BadRequestException('usualDay must be university, office, remote or mixed');
    }
    if (!['rarely', 'sometimes', 'often'].includes(formalDays)) {
      throw new BadRequestException('formalDays must be rarely, sometimes or often');
    }
    const defaultOccasion =
      usualDay === 'office'
        ? 'work'
        : usualDay === 'mixed'
          ? 'smart casual'
          : 'casual';

    const [, styleProfile] = await this.requireUserWithProfile(userId);
    let sp = styleProfile;
    if (!sp) sp = this.styleProfileRepo.create({ userId });
    sp.dimensions = {
      ...((sp.dimensions as Record<string, unknown>) ?? {}),
      onboarding: {
        usualDay,
        formalDays,
        defaultOccasion,
        answeredAt: new Date().toISOString(),
      },
    };
    // Learning: formal-heavy weeks shift his formality baseline up a notch.
    if (formalDays === 'often') {
      sp.formalityBias = Math.min(1, Number(sp.formalityBias ?? 0) + 0.2);
    }
    await this.styleProfileRepo.save(sp);
    return { onboarding: sp.dimensions['onboarding' as keyof typeof sp.dimensions] ?? (sp.dimensions as any).onboarding };
  }

  async updateStyleProfile(userId: string, body: Record<string, unknown>) {
    const [user, styleProfile] = await this.requireUserWithProfile(userId);
    const legacy = toLegacyUser(user, styleProfile);
    const next = writeStyleProfile(legacy, body || {});

    let sp = styleProfile;
    if (!sp) {
      sp = this.styleProfileRepo.create({ userId });
    }
    // Store the profile itself, not a summary: toLegacyUser reads these keys
    // back out, so storing counts here silently wiped every saved profile.
    sp.dimensions = {
      ...((sp.dimensions as Record<string, unknown>) ?? {}),
      gender: next.gender,
      favoriteColors: next.favoriteColors,
      preferredStyles: next.preferredStyles,
      avoidedColors: next.avoidedColors,
      heightCm: next.heightCm,
      weightKg: next.weightKg,
      fitPreference: next.fitPreference,
      sizes: next.sizes,
    } as unknown as Record<string, number>;
    await this.styleProfileRepo.save(sp);

    return { styleProfile: next, user: profilePayload(toLegacyUser(user, sp)) };
  }
}
