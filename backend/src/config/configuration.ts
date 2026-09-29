import { registerAs } from '@nestjs/config';

const bool = (value: string | undefined, fallback: boolean): boolean => {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
};

const int = (value: string | undefined, fallback: number): number => {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const appConfig = registerAs('app', () => ({
  env: process.env.NODE_ENV ?? 'development',
  port: int(process.env.PORT, 3000),
  globalPrefix: process.env.API_PREFIX ?? 'api',
  corsOrigins: (process.env.CORS_ORIGINS ?? '*')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
  enableSwagger: bool(process.env.ENABLE_SWAGGER, true),
  seedOnBoot: bool(process.env.SEED_ON_BOOT, true),
}));

export const databaseConfig = registerAs('database', () => {
  const type = process.env.DB_TYPE ?? 'sqlite';
  const common = {
    type,
    logging: bool(process.env.DB_LOGGING, false),
    synchronize: bool(process.env.DB_SYNCHRONIZE, true),
  };

  if (type === 'postgres') {
    return {
      ...common,
      type: 'postgres' as const,
      host: process.env.DB_HOST ?? 'localhost',
      port: int(process.env.DB_PORT, 5432),
      username: process.env.DB_USERNAME ?? 'postgres',
      password: process.env.DB_PASSWORD ?? 'postgres',
      database: process.env.DB_NAME ?? 'smartwardrobe',
      ssl: bool(process.env.DB_SSL, false) ? { rejectUnauthorized: false } : undefined,
    };
  }

  return {
    ...common,
    type: 'better-sqlite3' as const,
    database: process.env.DB_SQLITE_PATH ?? 'data/smartwardrobe.sqlite',
  };
});

export const redisConfig = registerAs('redis', () => ({
  host: process.env.REDIS_HOST ?? 'localhost',
  port: int(process.env.REDIS_PORT, 6379),
  password: process.env.REDIS_PASSWORD || undefined,
  ttlSeconds: int(process.env.REDIS_TTL_SECONDS, 300),
  /**
   * `auto` connects and silently degrades to the in-process cache when the
   * server is unreachable, so a missing Redis never blocks the API.
   */
  mode: process.env.REDIS_MODE ?? 'auto',
  keyPrefix: process.env.REDIS_KEY_PREFIX ?? 'sw:',
}));

export const jwtConfig = registerAs('jwt', () => ({
  accessSecret: process.env.JWT_ACCESS_SECRET ?? 'smartwardrobe-dev-access-secret',
  refreshSecret: process.env.JWT_REFRESH_SECRET ?? 'smartwardrobe-dev-refresh-secret',
  accessTtl: process.env.JWT_ACCESS_TTL ?? '15m',
  refreshTtl: process.env.JWT_REFRESH_TTL ?? '30d',
  bcryptRounds: int(process.env.BCRYPT_ROUNDS, 10),
}));

export const storageConfig = registerAs('storage', () => ({
  driver: process.env.STORAGE_DRIVER ?? 'local',
  localPath: process.env.STORAGE_LOCAL_PATH ?? 'storage',
  publicBaseUrl: process.env.STORAGE_PUBLIC_BASE_URL ?? 'http://localhost:3000/api/storage',
  s3Endpoint: process.env.S3_ENDPOINT,
  s3Region: process.env.S3_REGION ?? 'us-east-1',
  s3Bucket: process.env.S3_BUCKET,
  s3AccessKeyId: process.env.S3_ACCESS_KEY_ID,
  s3SecretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
  maxUploadBytes: int(process.env.MAX_UPLOAD_BYTES, 10 * 1024 * 1024),
}));

export const weatherConfig = registerAs('weather', () => ({
  provider: process.env.WEATHER_PROVIDER ?? 'openweathermap',
  apiKey: process.env.OPENWEATHERMAP_API_KEY,
  units: process.env.WEATHER_UNITS ?? 'metric',
  defaultLocation: process.env.DEFAULT_LOCATION ?? 'Cairo',
  defaultCountry: process.env.DEFAULT_COUNTRY ?? 'EG',
  cacheTtlSeconds: int(process.env.WEATHER_CACHE_TTL, 900),
}));

export const aiConfig = registerAs('ai', () => ({
  /** Endpoint of the FastAPI AI service described in the architecture doc. */
  serviceUrl: process.env.AI_SERVICE_URL ?? 'http://localhost:8000',
  timeoutMs: int(process.env.AI_SERVICE_TIMEOUT_MS, 20000),
  /** `rule-engine` keeps everything in-process; `http` proxies to FastAPI. */
  mode: process.env.AI_MODE ?? 'rule-engine',
  minMatchScore: int(process.env.AI_MIN_MATCH_SCORE, 55),
  maxRecommendations: int(process.env.AI_MAX_RECOMMENDATIONS, 12),
}));

export const queueConfig = registerAs('queue', () => ({
  /** BullMQ is wired but disabled unless Redis is explicitly enabled. */
  enabled: bool(process.env.QUEUE_ENABLED, false),
  name: process.env.QUEUE_NAME ?? 'smartwardrobe',
  concurrency: int(process.env.QUEUE_CONCURRENCY, 4),
}));

export const configFactories = [
  appConfig,
  databaseConfig,
  redisConfig,
  jwtConfig,
  storageConfig,
  weatherConfig,
  aiConfig,
  queueConfig,
];

export const configuration = () =>
  configFactories.reduce<Record<string, unknown>>((acc, factory) => {
    const [, value] = (factory as unknown as () => [string, unknown])();
    return { ...acc, ...(value as Record<string, unknown>) };
  }, {});
