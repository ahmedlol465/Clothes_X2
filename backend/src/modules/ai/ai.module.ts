import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { ClothingAnalyzerService } from './analyzers/clothing-analyzer.service';

@Module({
  imports: [ConfigModule],
  controllers: [AiController],
  providers: [AiService, ClothingAnalyzerService],
  exports: [AiService, ClothingAnalyzerService],
})
export class AiModule {}
