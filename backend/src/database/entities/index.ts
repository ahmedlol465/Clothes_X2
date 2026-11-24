/**
 * Every entity listed in section 7 "Data Model / Core entities" of the
 * SmartWardrobe specification, plus the supporting lookup tables.
 */
export {
  StyleMemory,
  StylePreference,
  StyleProfile,
  Subscription,
  User,
  UserProfile,
} from './identity.entity';

export {
  Brand,
  Category,
  ClothingAttribute,
  Wardrobe,
  WardrobeItem,
  WearEvent,
} from './wardrobe.entity';

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

export {
  Session,
} from './session.entity';

export {
  WeeklyPlan,
} from './weekly-plan.entity';

export {
  CommunityLook,
  TrendStyle,
} from './content.entity';

import {
  AIConversation,
  AIInteraction,
  AIUsage,
  AppNotification,
} from './ai.entity';
import {
  StyleMemory,
  StylePreference,
  StyleProfile,
  Subscription,
  User,
  UserProfile,
} from './identity.entity';
import {
  Brand,
  Category,
  ClothingAttribute,
  Wardrobe,
  WardrobeItem,
  WearEvent,
} from './wardrobe.entity';
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
import {
  Session,
} from './session.entity';
import {
  WeeklyPlan,
} from './weekly-plan.entity';
import {
  CommunityLook,
  TrendStyle,
} from './content.entity';

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
  Session,
  WeeklyPlan,
  TrendStyle,
  CommunityLook,
];
