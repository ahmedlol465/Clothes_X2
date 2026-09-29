/**
 * Every entity listed in section 7 "Data Model / Core entities" of the
 * SmartWardrobe specification, plus the supporting lookup tables.
 */
export {
  Brand,
  Category,
  ClothingAttribute,
  StyleMemory,
  StylePreference,
  StyleProfile,
  Subscription,
  User,
  UserProfile,
  Wardrobe,
  WardrobeItem,
  WearEvent,
} from './identity.entity';

export {
  Occasion,
  Outfit,
  OutfitFeedback,
  OutfitItem,
  Recommendation,
  RecommendationFeedback,
} from './outfit.entity';

export {
  CalendarEvent,
  EventSchedule,
  PackingList,
  Trip,
  WeatherSnapshot,
} from './planner.entity';

export {
  Purchase,
  ShoppingItem,
  WishlistItem,
} from './shopping.entity';

export {
  AIConversation,
  AIInteraction,
  AIUsage,
  AppNotification,
} from './ai.entity';

import {
  AIConversation,
  AIInteraction,
  AIUsage,
  AppNotification,
} from './ai.entity';
import {
  Brand,
  Category,
  ClothingAttribute,
  StyleMemory,
  StylePreference,
  StyleProfile,
  Subscription,
  User,
  UserProfile,
  Wardrobe,
  WardrobeItem,
  WearEvent,
} from './identity.entity';
import {
  Occasion,
  Outfit,
  OutfitFeedback,
  OutfitItem,
  Recommendation,
  RecommendationFeedback,
} from './outfit.entity';
import {
  CalendarEvent,
  EventSchedule,
  PackingList,
  Trip,
  WeatherSnapshot,
} from './planner.entity';
import {
  Purchase,
  ShoppingItem,
  WishlistItem,
} from './shopping.entity';

export const ALL_ENTITIES = [
  User,
  UserProfile,
  StyleProfile,
  StylePreference,
  StyleMemory,
  Subscription,
  Wardrobe,
  WardrobeItem,
  ClothingAttribute,
  Brand,
  Category,
  WearEvent,
  Occasion,
  Outfit,
  OutfitItem,
  OutfitFeedback,
  Recommendation,
  RecommendationFeedback,
  WeatherSnapshot,
  CalendarEvent,
  EventSchedule,
  Trip,
  PackingList,
  ShoppingItem,
  WishlistItem,
  Purchase,
  AIConversation,
  AIInteraction,
  AppNotification,
  AIUsage,
];
