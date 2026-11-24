import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';

import { AppCacheModule } from './common/cache/cache.service';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { HealthController } from './common/health.controller';
import { configFactories } from './config/configuration';
import { DatabaseModule } from './database/database.module';
import { AiModule } from './modules/ai/ai.module';
import { AuthModule } from './modules/auth/auth.module';
import { WardrobeModule } from './modules/wardrobe/wardrobe.module';
import { WeatherModule } from './modules/weather/weather.module';
import { UsersModule } from './modules/users/users.module';
import { OutfitsModule } from './modules/outfits/outfits.module';
import { ShopModule } from './modules/shop/shop.module';
import { AdminModule } from './modules/admin/admin.module';
import { StylistModule } from './modules/stylist/stylist.module';
import { PlannerModule } from './modules/planner/planner.module';
import { ContentModule } from './modules/content/content.module';
import { InsightsModule } from './modules/insights/insights.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      load: configFactories,
      envFilePath: ['.env.local', '.env'],
    }),
    DatabaseModule,
    AppCacheModule,
    AuthModule,
    AiModule,
    WeatherModule,
    WardrobeModule,
    UsersModule,
    OutfitsModule,
    ShopModule,
    AdminModule,
    StylistModule,
    PlannerModule,
    ContentModule,
    InsightsModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
