import {
  ConflictException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcryptjs';
import { DataSource, Repository } from 'typeorm';

import { CacheService } from '../../common/cache/cache.service';
import { UserRole } from '../../common/vocabularies';
import { StyleProfile, User, UserProfile, Wardrobe } from '../../database/entities';
import {
  AuthResponseDto,
  LoginDto,
  RegisterDto,
  SocialAuthDto,
} from './dto/auth.dto';
import { JwtPayload } from './jwt.strategy';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly dataSource: DataSource,
    private readonly cache: CacheService,
  ) {}

  async register(dto: RegisterDto): Promise<AuthResponseDto> {
    const existing = await this.users.findOne({ where: { email: dto.email } });
    if (existing) {
      throw new ConflictException('An account with this email already exists');
    }

    const rounds = this.config.get<number>('jwt.bcryptRounds') ?? 10;

    const user = await this.dataSource.transaction(async (manager) => {
      const created = manager.create(User, {
        email: dto.email,
        phone: dto.phone ?? null,
        passwordHash: await bcrypt.hash(dto.password, rounds),
        role: UserRole.USER,
        lastLoginAt: new Date(),
      });
      await manager.save(created);

      // Section 7: every account owns a profile, style profile and wardrobe.
      await manager.save(
        manager.create(UserProfile, {
          userId: created.id,
          firstName: dto.firstName ?? dto.email.split('@')[0],
          lastName: dto.lastName ?? null,
        }),
      );
      await manager.save(
        manager.create(StyleProfile, {
          userId: created.id,
          archetype: null,
          overallConfidence: 0,
        }),
      );
      const wardrobe = await manager.save(
        manager.create(Wardrobe, {
          userId: created.id,
          name: 'My Wardrobe',
          kind: 'primary',
        }),
      );
      created.defaultLocationCity = null;
      await manager.save(created);
      this.logger.log(`Registered ${created.email} (wardrobe ${wardrobe.id})`);

      return created;
    });

    return this.issueSession(user);
  }

  async login(dto: LoginDto): Promise<AuthResponseDto> {
    const user = await this.users
      .createQueryBuilder('user')
      .addSelect('user.passwordHash')
      .where('user.email = :email', { email: dto.email })
      .getOne();

    if (!user?.passwordHash || !(await bcrypt.compare(dto.password, user.passwordHash))) {
      throw new UnauthorizedException('Incorrect email or password');
    }

    user.lastLoginAt = new Date();
    await this.users.save(user);
    await this.cache.invalidateUser(user.id);

    return this.issueSession(user);
  }

  /** Email/Google/Apple/Phone entry point described in section 4.1. */
  async socialLogin(dto: SocialAuthDto): Promise<AuthResponseDto> {
    const identity = this.socialIdentity(dto);
    let user = await this.users.findOne({ where: { email: identity.email } });

    if (!user) {
      const rounds = this.config.get<number>('jwt.bcryptRounds') ?? 10;
      user = await this.dataSource.transaction(async (manager) => {
        const created = manager.create(User, {
          email: identity.email,
          phone: dto.provider === 'phone' ? dto.credential : null,
          passwordHash: await bcrypt.hash(`${dto.provider}:${dto.credential}`, rounds),
          role: UserRole.USER,
          emailVerified: dto.provider !== 'phone',
          lastLoginAt: new Date(),
        });
        await manager.save(created);
        await manager.save(
          manager.create(UserProfile, {
            userId: created.id,
            firstName: dto.firstName ?? identity.email.split('@')[0],
            lastName: dto.lastName ?? null,
          }),
        );
        await manager.save(
          manager.create(StyleProfile, { userId: created.id, overallConfidence: 0 }),
        );
        await manager.save(
          manager.create(Wardrobe, { userId: created.id, name: 'My Wardrobe', kind: 'primary' }),
        );
        return created;
      });
    }

    user.lastLoginAt = new Date();
    await this.users.save(user);
    return this.issueSession(user);
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

    const user = await this.users.findOne({ where: { id: payload.sub } });
    if (!user || user.tokenVersion !== payload.ver) {
      throw new UnauthorizedException('Session expired, please sign in again');
    }

    return this.issueSession(user);
  }

  /** Rotates the token version so every previously issued refresh token dies. */
  async logout(userId: string, refreshToken?: string): Promise<{ success: boolean }> {
    const user = await this.users.findOne({ where: { id: userId } });
    if (user) {
      user.tokenVersion += 1;
      await this.users.save(user);
    }
    await this.cache.invalidateUser(userId);
    this.logger.log(`Logout for ${userId}`);
    return { success: true };
  }

  async findById(id: string): Promise<User | null> {
    return this.users.findOne({ where: { id } });
  }

  private socialIdentity(dto: SocialAuthDto): { email: string } {
    if (dto.email) return { email: dto.email.trim().toLowerCase() };
    if (dto.provider === 'phone') {
      return { email: `phone-${dto.credential.replace(/[^0-9]/g, '')}@smartwardrobe.local` };
    }
    // A real deployment verifies the provider token before deriving the email;
    // locally we fall back to a stable pseudo-address so flows stay testable.
    const hash = require('node:crypto')
      .createHash('sha256')
      .update(`${dto.provider}:${dto.credential}`)
      .digest('hex')
      .slice(0, 20);
    return { email: `${dto.provider}-${hash}@smartwardrobe.local` };
  }

  private async issueSession(user: User): Promise<AuthResponseDto> {
    const accessTtl = this.config.get<string>('jwt.accessTtl') ?? '15m';
    const refreshTtl = this.config.get<string>('jwt.refreshTtl') ?? '30d';

    const base = {
      sub: user.id,
      email: user.email,
      role: user.role,
      ver: user.tokenVersion,
    };

    const accessToken = await this.jwt.signAsync(
      { ...base, type: 'access' } as JwtPayload,
      { secret: this.config.get<string>('jwt.accessSecret'), expiresIn: accessTtl },
    );
    const refreshToken = await this.jwt.signAsync(
      { ...base, type: 'refresh' } as JwtPayload,
      { secret: this.config.get<string>('jwt.refreshSecret'), expiresIn: refreshTtl },
    );

    const profile = await this.users.manager
      .getRepository(UserProfile)
      .findOne({ where: { userId: user.id } });

    return {
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        firstName: profile?.firstName ?? null,
        lastName: profile?.lastName ?? null,
        avatarUrl: user.avatarUrl,
        onboardingCompleted: user.onboardingCompleted,
        emailVerified: user.emailVerified,
        createdAt: (user.createdAt ?? new Date()).toISOString(),
      },
      tokens: {
        accessToken,
        refreshToken,
        expiresIn: this.parseTtl(accessTtl),
        tokenType: 'Bearer',
      },
    };
  }

  private parseTtl(ttl: string): number {
    const match = /^(\d+)([smhd])$/.exec(ttl);
    if (!match) return 900;
    const value = Number(match[1]);
    const unit = { s: 1, m: 60, h: 3600, d: 86400 }[match[2]];
    return value * unit;
  }
}
