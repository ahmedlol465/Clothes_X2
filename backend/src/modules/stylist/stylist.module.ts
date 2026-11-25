import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import {
  AIConversation,
  AIInteraction,
  AIUsage,
  Outfit,
  OutfitFeedback,
  StyleProfile,
  User,
  Wardrobe,
  WardrobeItem,
} from '../../database/entities';
import { AiModule } from '../ai/ai.module';
import { StylistController } from './stylist.controller';
import { StylistService } from './stylist.service';
import { StylistChatService } from './services/chat.service';
import { StylistConversationService } from './services/conversation.service';
import { StylistContextService } from './services/context.service';
import { StylistStreamingService } from './services/streaming.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      WardrobeItem,
      Wardrobe,
      AIConversation,
      AIInteraction,
      AIUsage,
      StyleProfile,
      Outfit,
      OutfitFeedback,
      User,
    ]),
    AiModule,
  ],
  controllers: [StylistController],
  providers: [
    StylistService,
    StylistChatService,
    StylistConversationService,
    StylistContextService,
    StylistStreamingService,
  ],
  exports: [
    StylistService,
    StylistConversationService,
    StylistContextService,
    StylistStreamingService,
  ],
})
export class StylistModule {}
