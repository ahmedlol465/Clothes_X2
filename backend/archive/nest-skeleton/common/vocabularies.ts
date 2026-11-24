/**
 * Controlled vocabularies shared by entities, DTOs and the AI rule engine.
 *
 * Values are stored as plain strings (never DB enums) so the schema is
 * byte-identical on PostgreSQL and SQLite.
 */

export const ClothingCategory = {
  TOP: 'Tops',
  BOTTOM: 'Bottoms',
  SHOES: 'Shoes',
  OUTERWEAR: 'Outerwear',
  ACCESSORIES: 'Accessories',
  BAGS: 'Bags',
  WATCHES: 'Watches',
  HATS: 'Hats',
  FORMAL_WEAR: 'Formalwear',
  SPORTSWEAR: 'Sportswear',
  HOMEWEAR: 'Homewear',
} as const;
export type ClothingCategory = (typeof ClothingCategory)[keyof typeof ClothingCategory];

export const CLOTHING_CATEGORIES: ClothingCategory[] = Object.values(ClothingCategory);

/** Ordinal position inside an outfit. Drives layer ordering and the builder. */
export const OutfitSlot = {
  OUTERWEAR: 'outerwear',
  TOP: 'top',
  BOTTOM: 'bottom',
  DRESS: 'dress',
  SHOES: 'shoes',
  ACCESSORY: 'accessory',
  BAG: 'bag',
  WATCH: 'watch',
  HAT: 'hat',
} as const;
export type OutfitSlot = (typeof OutfitSlot)[keyof typeof OutfitSlot];

export const OUTFIT_SLOTS: OutfitSlot[] = Object.values(OutfitSlot);

/** An outfit is never complete without at least a top/or bottom and shoes. */
export const REQUIRED_SLOTS: OutfitSlot[] = ['top', 'bottom', 'shoes'];

export const Season = {
  SPRING_SUMMER: 'Spring / Summer',
  AUTUMN_WINTER: 'Autumn / Winter',
  ALL_SEASON: 'All Season',
  SPRING: 'Spring',
  SUMMER: 'Summer',
  AUTUMN: 'Autumn',
  WINTER: 'Winter',
} as const;
export type Season = (typeof Season)[keyof typeof Season];

export const Formality = {
  CASUAL: 'Casual',
  SMART_CASUAL: 'Smart Casual',
  BUSINESS_CASUAL: 'Business Casual',
  FORMAL: 'Formal',
  ELEGANT: 'Elegant',
  SPORTY: 'Sporty',
  LOUNGEWEAR: 'Loungewear',
} as const;
export type Formality = (typeof Formality)[keyof typeof Formality];

export const OccasionType = {
  DAILY: 'Daily',
  UNIVERSITY: 'University',
  WORK: 'Work',
  MEETING: 'Meeting',
  DATE: 'Date',
  PARTY: 'Party',
  FORMAL_EVENT: 'Formal Event',
  WEDDING: 'Wedding',
  SPORT: 'Sport',
  LEISURE: 'Leisure',
  TRAVEL: 'Travel',
  BUSINESS_TRIP: 'Business Trip',
} as const;
export type OccasionType = (typeof OccasionType)[keyof typeof OccasionType];

export const UserRole = {
  USER: 'user',
  ADMIN: 'admin',
} as const;
export type UserRole = (typeof UserRole)[keyof typeof UserRole];

export const RecommendationMode = {
  WHAT_SHOULD_I_WEAR: 'what_should_i_wear',
  DRESS_ME_FOR: 'dress_me_for',
  BUILD_ME: 'build_me',
} as const;
export type RecommendationMode = (typeof RecommendationMode)[keyof typeof RecommendationMode];

export const OutfitSource = {
  AI_RECOMMENDED: 'ai_recommended',
  MANUAL: 'manual',
  REMIX: 'remix',
  PLANNER: 'planner',
  TRAVEL: 'travel',
} as const;
export type OutfitSource = (typeof OutfitSource)[keyof typeof OutfitSource];

/**
 * The eleven scoring factors listed in the "Outfit Recommendations" section of
 * the specification. Weight defaults follow the doc's ordering.
 */
export const MatchFactor = {
  COLOR_HARMONY: 'color_harmony',
  STYLE_COMPATIBILITY: 'style_compatibility',
  OCCASION_FIT: 'occasion_fit',
  WEATHER_MATCH: 'weather_match',
  SEASON_MATCH: 'season_match',
  PERSONAL_PREFERENCE: 'personal_preference',
  BODY_FIT_PREFERENCE: 'body_fit_preference',
  RECENT_USAGE: 'recent_usage',
  WARDROBE_AVAILABILITY: 'wardrobe_availability',
  TREND_COMPATIBILITY: 'trend_compatibility',
  USER_FEEDBACK: 'user_feedback',
} as const;
export type MatchFactor = (typeof MatchFactor)[keyof typeof MatchFactor];

export const MATCH_FACTORS: MatchFactor[] = Object.values(MatchFactor);

export const MATCH_FACTOR_LABELS: Record<MatchFactor, string> = {
  [MatchFactor.COLOR_HARMONY]: 'Color Harmony',
  [MatchFactor.STYLE_COMPATIBILITY]: 'Style Compatibility',
  [MatchFactor.OCCASION_FIT]: 'Occasion Fit',
  [MatchFactor.WEATHER_MATCH]: 'Weather Match',
  [MatchFactor.SEASON_MATCH]: 'Season Match',
  [MatchFactor.PERSONAL_PREFERENCE]: 'Personal Taste',
  [MatchFactor.BODY_FIT_PREFERENCE]: 'Fit Preference',
  [MatchFactor.RECENT_USAGE]: 'Recent Usage',
  [MatchFactor.WARDROBE_AVAILABILITY]: 'Wardrobe Availability',
  [MatchFactor.TREND_COMPATIBILITY]: 'Trend Compatibility',
  [MatchFactor.USER_FEEDBACK]: 'Your Feedback',
};

/** Relative influence of each factor on the final 0-100 compatibility score. */
export const MATCH_FACTOR_WEIGHTS: Record<MatchFactor, number> = {
  [MatchFactor.COLOR_HARMONY]: 0.16,
  [MatchFactor.STYLE_COMPATIBILITY]: 0.13,
  [MatchFactor.OCCASION_FIT]: 0.14,
  [MatchFactor.WEATHER_MATCH]: 0.12,
  [MatchFactor.SEASON_MATCH]: 0.08,
  [MatchFactor.PERSONAL_PREFERENCE]: 0.14,
  [MatchFactor.BODY_FIT_PREFERENCE]: 0.06,
  [MatchFactor.RECENT_USAGE]: 0.06,
  [MatchFactor.WARDROBE_AVAILABILITY]: 0.05,
  [MatchFactor.TREND_COMPATIBILITY]: 0.03,
  [MatchFactor.USER_FEEDBACK]: 0.03,
};

export const RemixVariant = {
  CASUAL: 'casual',
  COLD: 'cold',
  DATE: 'date',
  SUMMER: 'summer',
  FORMAL: 'formal',
} as const;
export type RemixVariant = (typeof RemixVariant)[keyof typeof RemixVariant];

export const RemixLabels: Record<RemixVariant, string> = {
  [RemixVariant.CASUAL]: 'Casual version',
  [RemixVariant.COLD]: 'Cold version',
  [RemixVariant.DATE]: 'Date version',
  [RemixVariant.SUMMER]: 'Summer version',
  [RemixVariant.FORMAL]: 'Formal version',
};

export const FeedbackType = {
  LIKED: 'liked',
  DISLIKED: 'disliked',
  WORN: 'worn',
  RATED: 'rated',
} as const;
export type FeedbackType = (typeof FeedbackType)[keyof typeof FeedbackType];

/** Where a `StyleMemory` row was learned from (doc section 7). */
export const StyleMemorySource = {
  OUTFIT_FEEDBACK: 'outfit_feedback',
  EXPLICIT_FEEDBACK: 'explicit_feedback',
  WEAR_HISTORY: 'wear_history',
  ONBOARDING: 'onboarding',
  AI_ANALYSIS: 'ai_analysis',
  CHAT: 'chat',
} as const;
export type StyleMemorySource = (typeof StyleMemorySource)[keyof typeof StyleMemorySource];

export const ItemStatus = {
  ACTIVE: 'active',
  ARCHIVED: 'archived',
  DELETED: 'deleted',
} as const;
export type ItemStatus = (typeof ItemStatus)[keyof typeof ItemStatus];

export const FitType = {
  SLIM: 'Slim',
  REGULAR: 'Regular',
  RELAXED: 'Relaxed',
  OVERSIZED: 'Oversized',
} as const;
export type FitType = (typeof FitType)[keyof typeof FitType];

export const PatternType = {
  SOLID: 'Solid',
  STRIPED: 'Striped',
  CHECKED: 'Checked',
  PRINTED: 'Printed',
  POLKA_DOT: 'Polka Dot',
  FLAORED: 'Flared',
} as const;
export type PatternType = (typeof PatternType)[keyof typeof PatternType];

export const ItemCondition = {
  NEW: 'New',
  EXCELLENT: 'Excellent',
  GOOD: 'Good',
  FAIR: 'Fair',
} as const;
export type ItemCondition = (typeof ItemCondition)[keyof typeof ItemCondition];
