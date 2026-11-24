import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService, JwtSignOptions } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'node:crypto';

import { CacheService } from '../../common/cache/cache.service';
import { profilePayload } from '../../common/legacy/legacy-style';
import { LegacyUser } from '../../common/legacy/legacy.types';
import { UserRole } from '../../common/vocabularies';
import {
  AuthResponseDto,
  LoginDto,
  RegisterDto,
  SocialAuthDto,
} from './dto/auth.dto';
import { JwtPayload } from './jwt.strategy';
import { User } from '../../database/entities/identity.entity';
import { StyleProfile } from '../../database/entities/identity.entity';

function uid(prefix = 'u'): string {
  return `${prefix}_${crypto.randomBytes(6).toString('hex')}`;
}

function userToLegacyUser(user: User, styleProfile: StyleProfile | null): LegacyUser {
  const dimensions = (styleProfile?.dimensions ?? {}) as Record<string, unknown>;
  const sizes = dimensions.sizes as Record<string, unknown> | undefined;
  return {
    id: user.id,
    name: user.name ?? user.email.split('@')[0],
    email: user.email,
    passwordHash: user.passwordHash ?? null,
    createdAt: user.createdAt?.toISOString() ?? new Date().toISOString(),
    avatarUrl: user.avatarUrl ?? null,
    styleProfile: {
      favoriteColors: Array.isArray(dimensions.favoriteColors) ? dimensions.favoriteColors : [],
      preferredStyles: Array.isArray(dimensions.preferredStyles) ? dimensions.preferredStyles : [],
      avoidedColors: Array.isArray(dimensions.avoidedColors) ? dimensions.avoidedColors : [],
      heightCm: typeof dimensions.heightCm === 'number' ? dimensions.heightCm : null,
      weightKg: typeof dimensions.weightKg === 'number' ? dimensions.weightKg : null,
      fitPreference: typeof dimensions.fitPreference === 'string' ? dimensions.fitPreference : 'regular',
      sizes: {
        top: typeof sizes?.top === 'string' ? sizes.top : null,
        bottom: typeof sizes?.bottom === 'string' ? sizes.bottom : null,
        shoe: typeof sizes?.shoe === 'string' ? sizes.shoe : null,
      },
    },
    tokenVersion: user.tokenVersion ?? 0,
    role: user.role ?? 'user',
  };
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @InjectRepository(StyleProfile) private readonly styleProfileRepo: Repository<StyleProfile>,
    private readonly dataSource: DataSource,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly cache: CacheService,
  ) {}

  async register(dto: RegisterDto): Promise<AuthResponseDto> {
    const existing = await this.userRepo.findOne({ where: { email: String(dto.email).toLowerCase() } });
    if (existing) {
      throw new ConflictException('An account with this email already exists');
    }

    const rounds = this.config.get<number>('jwt.bcryptRounds') ?? 10;
    const name =
      dto.name ||
      [dto.firstName, dto.lastName].filter(Boolean).join(' ') ||
      dto.email.split('@')[0];

    return this.dataSource.transaction(async (manager) => {
      const user = manager.create(User, {
        id: uid(),
        name: name.trim(),
        email: String(dto.email).toLowerCase(),
        passwordHash: await bcrypt.hash(dto.password, rounds),
        createdAt: new Date(),
        avatarUrl: null,
        tokenVersion: 0,
        role: UserRole.USER,
      });
      await manager.save(user);

      const styleProfile = new StyleProfile();
      styleProfile.userId = user.id;
      styleProfile.dimensions = {
        favoriteColors: 0,
        preferredStyles: 0,
        avoidedColors: 0,
        heightCm: 0,
        weightKg: 0,
        fitPreference: 1,
        sizes: 0,
      } as Record<string, number>;
      styleProfile.overallConfidence = 0;
      await manager.save(styleProfile);

      const legacyUser = userToLegacyUser(user, styleProfile);
      this.logger.log(`Registered ${user.email}`);
      return this.issueSession(legacyUser);
    });
  }

  async login(dto: LoginDto): Promise<AuthResponseDto> {
    const user = await this.userRepo
      .createQueryBuilder('user')
      .addSelect('user.passwordHash')
      .where('user.email = :email', { email: String(dto.email).toLowerCase() })
      .getOne();

    if (!user || !(await this.verifyPassword(dto.password, user.passwordHash))) {
      throw new UnauthorizedException('Incorrect email or password');
    }

    // Accounts imported from the old JSON store carry a SHA-256 hash. Upgrade
    // them to bcrypt on the first successful sign-in, without asking the user.
    if (user.passwordHash && /^[a-f0-9]{64}$/i.test(user.passwordHash)) {
      const rounds = this.config.get<number>('jwt.bcryptRounds') ?? 10;
      user.passwordHash = await bcrypt.hash(dto.password, rounds);
      await this.userRepo.save(user);
    }

    const styleProfile = await this.styleProfileRepo.findOne({ where: { userId: user.id } });
    await this.cache.invalidateUser(user.id);
    return this.issueSession(userToLegacyUser(user, styleProfile));
  }

  /** Exposes (to anyone) only whether a Google Client ID is configured. */
  googleClientStatus(): { configured: boolean; clientId: string | null } {
    const clientId = this.config.get<string>('google.clientId') ?? '';
    // The web sign-in flow needs the Client ID in the page, so it is not a
    // secret; still, only expose it when present.
    return { configured: clientId.length > 0, clientId: clientId || null };
  }

  /**
   * Google sign-in. The client sends the ID token it got from Google
   * Identity Services; we verify it with Google, pin it to our configured
   * Client ID, and only then trust the email inside.
   */
  async googleLogin(idToken: string): Promise<AuthResponseDto> {
    const clientId = this.config.get<string>('google.clientId') ?? '';
    if (!clientId) {
      throw new BadRequestException(
        'Google sign-in is not configured on the server (GOOGLE_CLIENT_ID missing).',
      );
    }
    const profile = await verifyGoogleIdToken(idToken, clientId);
    return this.socialLogin({
      provider: 'google',
      credential: profile.sub,
      email: profile.email,
      firstName: profile.givenName,
      lastName: profile.familyName,
    } as SocialAuthDto);
  }

  /** Email/Google/Apple/Phone entry point described in section 4.1. */
  async socialLogin(dto: SocialAuthDto): Promise<AuthResponseDto> {
    const email = this.socialEmail(dto);
    let user = await this.userRepo.findOne({ where: { email } });

    if (!user) {
      const rounds = this.config.get<number>('jwt.bcryptRounds') ?? 10;
      return this.dataSource.transaction(async (manager) => {
        user = manager.create(User, {
          id: uid(),
          name: [dto.firstName, dto.lastName].filter(Boolean).join(' ') || email.split('@')[0],
          email,
          passwordHash: await bcrypt.hash(`${dto.provider}:${dto.credential}`, rounds),
          createdAt: new Date(),
          avatarUrl: null,
          tokenVersion: 0,
          role: UserRole.USER,
        });
        await manager.save(user);

        const styleProfile = new StyleProfile();
        styleProfile.userId = user.id;
      styleProfile.dimensions = {
        favoriteColors: 0,
        preferredStyles: 0,
        avoidedColors: 0,
        heightCm: 0,
        weightKg: 0,
        fitPreference: 1,
        sizes: 0,
      } as Record<string, number>;
      styleProfile.overallConfidence = 0;
      await manager.save(styleProfile);

        const legacyUser = userToLegacyUser(user, styleProfile);
        return this.issueSession(legacyUser);
      });
    }

    const styleProfile = await this.styleProfileRepo.findOne({ where: { userId: user.id } });
    return this.issueSession(userToLegacyUser(user, styleProfile));
  }

  async refresh(refreshToken: string): Promise<AuthResponseDto> {
    let payload: JwtPayload;
    try {
      payload = await this.jwt.verifyAsync<JwtPayload>(refreshToken, {
        secret: this.config.get<string>('jwt.refreshSecret'),
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    if (payload.type !== 'refresh') {
      throw new UnauthorizedException('An access token cannot be refreshed');
    }

    const user = await this.userRepo.findOne({ where: { id: payload.sub } });
    if (!user || (user.tokenVersion ?? 0) !== payload.ver) {
      throw new UnauthorizedException('Session expired, please sign in again');
    }

    const styleProfile = await this.styleProfileRepo.findOne({ where: { userId: user.id } });
    return this.issueSession(userToLegacyUser(user, styleProfile));
  }

  /** Rotates the token version so every previously issued refresh token dies. */
  async logout(userId: string, refreshToken?: string): Promise<{ success: boolean }> {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (user) {
      await this.userRepo.increment({ id: userId }, 'tokenVersion', 1);
    }
    await this.cache.invalidateUser(userId);
    this.logger.log(`Logout for ${userId}`);
    return { success: true };
  }

  findById(id: string): LegacyUser | null {
    throw new Error('findById is not supported in TypeORM mode; use UsersService instead.');
  }

  private async verifyPassword(password: string, hash: string | null): Promise<boolean> {
    if (!hash) return false;
    if (/^[a-f0-9]{64}$/i.test(hash)) {
      return this.legacySha256(password) === hash.toLowerCase();
    }
    try {
      return await bcrypt.compare(password, hash);
    } catch {
      return false;
    }
  }

  private legacySha256(value: string): string {
    return crypto.createHash('sha256').update(String(value)).digest('hex');
  }

  private socialEmail(dto: SocialAuthDto): string {
    if (dto.email) return dto.email.trim().toLowerCase();
    if (dto.provider === 'phone') {
      return `phone-${dto.credential.replace(/[^0-9]/g, '')}@smartwardrobe.local`;
    }
    const hash = crypto
      .createHash('sha256')
      .update(`${dto.provider}:${dto.credential}`)
      .digest('hex')
      .slice(0, 20);
    return `${dto.provider}-${hash}@smartwardrobe.local`;
  }

  private async issueSession(user: LegacyUser): Promise<AuthResponseDto> {
    const accessTtl = this.config.get<string>('jwt.accessTtl') ?? '15m';
    const refreshTtl = this.config.get<string>('jwt.refreshTtl') ?? '30d';

    const base = {
      sub: user.id,
      email: user.email,
      role: user.role,
      ver: user.tokenVersion ?? 0,
    };

    const accessToken = await this.jwt.signAsync(
      { ...base, type: 'access' } as JwtPayload,
      {
        secret: this.config.get<string>('jwt.accessSecret'),
        expiresIn: accessTtl as JwtSignOptions['expiresIn'],
      },
    );
    const refreshToken = await this.jwt.signAsync(
      { ...base, type: 'refresh' } as JwtPayload,
      {
        secret: this.config.get<string>('jwt.refreshSecret'),
        expiresIn: refreshTtl as JwtSignOptions['expiresIn'],
      },
    );
    const expiresIn = this.parseTtl(accessTtl);

    return {
      user: profilePayload(user) as any,
      accessToken,
      refreshToken,
      expiresIn,
      tokenType: 'Bearer',
      tokens: { accessToken, refreshToken, expiresIn, tokenType: 'Bearer' },
    } as AuthResponseDto & Record<string, unknown>;
  }

  private parseTtl(ttl: string): number {
    const match = /^(\d+)([smhd])$/.exec(ttl);
    if (!match) return 900;
    const value = Number(match[1]);
    const unit = { s: 1, m: 60, h: 3600, d: 86400 }[match[2]];
    return value * unit;
  }
}
