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

  const origins = config.get<string[]>('app.corsOrigins') ?? ['*'];
  app.enableCors({
    origin: origins.includes('*') ? true : origins,
    credentials: true,
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
