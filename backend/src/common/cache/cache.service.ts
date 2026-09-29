import {
  CACHE_MANAGER,
  Inject,
  Injectable,
  Logger,
  Module,
} from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { CacheModule as NestCacheModule } from '@nestjs/cache-manager';
import type { Cache, Store } from 'cache-manager';
import * as net from 'node:net';

/**
 * Section 6.4 of the spec puts Redis in front of "caching, queues,
 * notifications". Redis is probed once at boot: if it answers we use it as the
 * cache store, otherwise we transparently fall back to the in-process store so
 * caching never becomes a hard dependency of the API.
 */
@Injectable()
export class CacheService {
  private readonly logger = new Logger(CacheService.name);
  private readonly inflight = new Map<string, Promise<unknown>>();

  constructor(
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
    private readonly config: ConfigService,
  ) {}

  static async isReachable(host: string, port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const socket = new net.Socket();
      const done = (ok: boolean) => {
        socket.removeAllListeners();
        socket.destroy();
        resolve(ok);
      };
      socket.setTimeout(1500);
      socket.once('connect', () => done(true));
      socket.once('timeout', () => done(false));
      socket.once('error', () => done(false));
      socket.connect(port, host);
    });
  }

  get defaultTtl(): number {
    return this.config.get<number>('redis.ttlSeconds') ?? 300;
  }

  async get<T>(key: string): Promise<T | null> {
    const value = await this.cache.get<T>(this.scoped(key));
    return value === undefined ? null : value;
  }

  async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    await this.cache.set(this.scoped(key), value, ttlSeconds ?? this.defaultTtl);
  }

  /**
   * Read-through caching. Concurrent misses for the same key share one
   * execution so a burst of Home requests cannot stampede the database.
   */
  async remember<T>(key: string, ttlSeconds: number, factory: () => Promise<T>): Promise<T> {
    const scoped = this.scoped(key);

    const hit = await this.cache.get<T>(scoped);
    if (hit !== undefined && hit !== null) return hit;

    const pending = this.inflight.get(scoped);
    if (pending) return pending as Promise<T>;

    const promise = factory()
      .then(async (value) => {
        await this.cache.set(scoped, value, ttlSeconds);
        return value;
      })
      .finally(() => {
        this.inflight.delete(scoped);
      });

    this.inflight.set(scoped, promise);
    return promise;
  }

  async del(...keys: string[]): Promise<void> {
    if (!keys.length) return;
    await Promise.all(keys.map((key) => this.cache.del(this.scoped(key))));
  }

  /** Drops every cached fragment owned by a single user. */
  async invalidateUser(userId: string): Promise<void> {
    await this.del(
      `home:${userId}`,
      `weather:${userId}`,
      `outfits:recommended:${userId}`,
      `wardrobe:health:${userId}`,
      `shop:recommended:${userId}`,
    );
  }

  async clear(): Promise<void> {
    await this.cache.clear();
  }

  private scoped(key: string): string {
    return `${this.config.get<string>('redis.keyPrefix') ?? 'sw:'}${key}`;
  }
}

/** Builds a cache-manager store: Redis when reachable, memory otherwise. */
async function buildStore(
  config: ConfigService,
  logger: Logger,
): Promise<{ store: Store; max: number; ttl: number }> {
  const mode = config.get<string>('redis.mode') ?? 'auto';
  const host = config.get<string>('redis.host') ?? 'localhost';
  const port = config.get<number>('redis.port') ?? 6379;
  const ttl = config.get<number>('redis.ttlSeconds') ?? 300;

  const memory = { max: 5000, ttl };

  if (mode !== 'memory' && (await CacheService.isReachable(host, port))) {
    try {
      const [{ default: Keyv }, { default: KeyvRedis }] = await Promise.all([
        import('keyv'),
        import('keyv-redis'),
      ]);
      const url = config.get<string>('redis.password')
        ? `redis://:${config.get<string>('redis.password')}@${host}:${port}`
        : `redis://${host}:${port}`;
      logger.log(`Cache store: Redis at ${host}:${port}`);
      return { store: new Keyv({ store: new KeyvRedis({ url }) }) as Store, max: 20000, ttl };
    } catch (error) {
      logger.warn(
        `Redis is up but the keyv-redis store could not be loaded (${(error as Error).message}). Using memory.`,
      );
    }
  }

  logger.warn(
    mode === 'memory'
      ? 'Cache store: in-process memory (REDIS_MODE=memory).'
      : 'Cache store: in-process memory (Redis unreachable).',
  );
  return { store: 'memory' as Store, ...memory };
}

@Global()
@Module({
  imports: [
    ConfigModule,
    NestCacheModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: async (config: ConfigService) => buildStore(config, new Logger('Cache')),
    }),
  ],
  providers: [CacheService],
  exports: [CacheService],
})
export class AppCacheModule {}
