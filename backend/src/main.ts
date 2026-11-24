import 'reflect-metadata';

import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory, Reflector } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { useContainer } from 'class-validator';
import compression from 'compression';
import helmet from 'helmet';

import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';

// ----------------------------------------------------------------- rate limit
// In-memory, per-IP + per-endpoint rate limiter for the NestJS runtime. No new
// dependency: the map is small, short-lived, and sufficient for a single
// process. Stricter limits on auth and AI endpoints where abuse is costly.
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const rateLimitWindowMs = 60 * 1000;
const rateLimitRules: Record<string, number> = {
  '/auth/login': 5,
  '/auth/register': 3,
  '/auth/refresh': 10,
  '/ai/': 20,
};
function rateLimitKey(ip: string, path: string): string {
  let bucket = 'other';
  for (const [prefix] of Object.entries(rateLimitRules)) {
    if (path === prefix || path.startsWith(prefix)) { bucket = prefix; break; }
  }
  return `${ip}:${bucket}`;
}
function rateLimit(req: any, res: any, next: () => void) {
  const ip = req.ip || req.connection?.remoteAddress || 'unknown';
  const key = rateLimitKey(ip, req.path);
  const now = Date.now();
  const entry = rateLimitMap.get(key) || { count: 0, resetAt: now + rateLimitWindowMs };
  if (now > entry.resetAt) {
    entry.count = 0;
    entry.resetAt = now + rateLimitWindowMs;
  }
  entry.count++;
  rateLimitMap.set(key, entry);

  let limit = 100;
  for (const [prefix, l] of Object.entries(rateLimitRules)) {
    if (req.path === prefix || req.path.startsWith(prefix)) { limit = l; break; }
  }

  if (entry.count > limit) {
    const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
    res.set('Retry-After', String(retryAfter));
    return res.status(429).json({
      error: 'Too many requests. Please slow down.',
      retryAfter,
    });
  }
  res.set('X-RateLimit-Limit', String(limit));
  res.set('X-RateLimit-Remaining', String(Math.max(0, limit - entry.count)));
  next();
}

// Periodic cleanup of expired rate-limit entries (every 5 minutes).
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimitMap.entries()) {
    if (now > entry.resetAt) rateLimitMap.delete(key);
  }
}, 5 * 60 * 1000);

async function bootstrap() {
  const logger = new Logger('Bootstrap');

  const app = await NestFactory.create(AppModule, { bufferLogs: false });

  useContainer(app.select(AppModule), { fallbackOnErrors: true });

  const config = app.get(ConfigService);
  const port = config.get<number>('app.port') ?? 3000;
  const prefix = config.get<string>('app.globalPrefix') ?? 'api';

  app.setGlobalPrefix(prefix);
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(compression());
  app.use(rateLimit);
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: false,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalInterceptors(new ResponseInterceptor());

  // CORS: never combine wildcard origins with credentials. Default origins are
  // localhost dev ports only; production must set CORS_ORIGINS explicitly.
  const configuredOrigins = config.get<string[]>('app.corsOrigins') ?? [];
  const hasExplicitOrigins = configuredOrigins.length > 0 &&
    !configuredOrigins.includes('*');
  const corsOrigins = hasExplicitOrigins
    ? configuredOrigins
    : ['http://localhost:3000', 'http://localhost:3001', 'http://127.0.0.1:3000', 'http://127.0.0.1:3001'];
  app.enableCors({
    origin: corsOrigins,
    credentials: hasExplicitOrigins,
    exposedHeaders: ['X-Total-Count'],
  });

  if (config.get<boolean>('app.enableSwagger') ?? true) {
    const documentConfig = new DocumentBuilder()
      .setTitle('SmartWardrobe API')
      .setDescription(
        'NestJS main backend for the SmartWardrobe AI fashion stylist. ' +
          'Implements the documented API overview: Auth, Users, Wardrobe, AI, ' +
          'Outfits, Planner, Shopping, Admin, plus the Home/Today command centre.',
      )
      .setVersion('1.0.0')
      .addBearerAuth(
        { type: 'http', scheme: 'bearer', bearerFormat: 'JWT', in: 'header' },
        'bearer',
      )
      .addTag('Home', 'Section 4.2 - the daily personalised command centre')
      .addTag('Auth', 'Section 8.1')
      .addTag('Users', 'Section 8.2')
      .addTag('Wardrobe', 'Section 8.3')
      .addTag('AI', 'Section 8.4')
      .addTag('Outfits', 'Section 8.5')
      .addTag('Planner', 'Section 8.6')
      .addTag('Shopping', 'Section 8.7')
      .addTag('Admin', 'Section 8.8')
      .addTag('Weather', 'Live conditions via keyless Open-Meteo')
      .build();

    const document = SwaggerModule.createDocument(app, documentConfig);
    SwaggerModule.setup('docs', app, document, {
      swaggerOptions: { persistAuthorization: true },
    });
    logger.log(`Swagger UI:  http://localhost:${port}/docs`);
  }

  await app.listen(port, '0.0.0.0');
  logger.log(`SmartWardrobe API listening on http://localhost:${port}/${prefix}`);
  logger.log(`Health check:  http://localhost:${port}/${prefix}/health`);
}

void bootstrap();
