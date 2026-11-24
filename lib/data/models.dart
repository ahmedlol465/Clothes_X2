import 'package:flutter/widgets.dart';

/// A single garment in the user's wardrobe.
@immutable
class ClothingItem {
  const ClothingItem({
    required this.id,
    required this.name,
    required this.image,
    required this.category,
    required this.color,
    required this.style,
    required this.material,
    required this.season,
    required this.formality,
    this.timesWorn = 0,
    this.lastWornLabel,
  });

  final String id;
  final String name;
  final String image;
  final String category;
  final String color;
  final String style;
  final String material;
  final String season;
  final String formality;
  final int timesWorn;
  final String? lastWornLabel;

  /// Compact "Tops • White" style summary used under the product name.
  String get meta => '$category • $color';

  ClothingItem copyWith({
    String? name,
    String? image,
    String? category,
    String? color,
    String? style,
    String? material,
    String? season,
    String? formality,
    int? timesWorn,
    String? lastWornLabel,
  }) =>
      ClothingItem(
        id: id,
        name: name ?? this.name,
        image: image ?? this.image,
        category: category ?? this.category,
        color: color ?? this.color,
        style: style ?? this.style,
        material: material ?? this.material,
        season: season ?? this.season,
        formality: formality ?? this.formality,
        timesWorn: timesWorn ?? this.timesWorn,
        lastWornLabel: lastWornLabel ?? this.lastWornLabel,
      );
}

/// One scored factor of the 11-factor compatibility engine
/// (`backend/src/scoring.js`).
///
/// [applied] is false when the engine had no evidence for the factor (no style
/// profile, no ratings). Such factors are excluded from the weighted mean and
/// renormalised, so they must be shown as "no signal" rather than as a score.
@immutable
class MatchFactor {
  const MatchFactor({
    this.key = '',
    required this.label,
    required this.value,
    this.weight = 0,
    this.applied = true,
    this.contribution = 0,
  });

  final String key;
  final String label;
  final int value;

  /// Renormalised share of the total score, 0..1.
  final double weight;

  /// False when the engine had no evidence and dropped the factor.
  final bool applied;

  /// [value] x [weight] — the points this factor actually contributed.
  final double contribution;

  /// Matches the legacy `(label, value)` shape used by the mock data.
  ({String label, int value}) get row => (label: label, value: value);
}

/// A saved or AI generated outfit.
@immutable
class Outfit {
  const Outfit({
    required this.id,
    required this.name,
    required this.image,
    required this.occasion,
    required this.match,
    required this.pieces,
    this.summary,
    this.itemIds,
    this.breakdown,
    this.factors,
    this.explanation,
    this.favorite = false,
    this.completeness,
    this.variant,
    this.note,
    this.keptFromOriginal,
    this.regenerated = false,
    this.createdAt,
  });

  final String id;
  final String name;
  final String image;
  final String occasion;
  final int match;

  /// Names of the garments combined into this outfit.
  final List<String> pieces;
  final String? summary;

  /// Backend outfit fields (§8.5). Null for client-side previews.
  final List<String>? itemIds;
  final List<({String label, int value})>? breakdown;

  /// Full 11-factor report with weights and signal flags. Preferred over
  /// [breakdown] wherever the UI can show which factors actually counted.
  final List<MatchFactor>? factors;
  final String? explanation;
  final bool favorite;

  /// Completeness of the look (0..1) from the scoring engine's gate.
  final double? completeness;

  /// Remix variant key (`casual`, `cold`, `summer`, `date`, `formal`).
  final String? variant;

  /// Set by `/ai/remix` when the original outfit already suits the context.
  final String? note;

  /// How many pieces of the submitted outfit survived the remix.
  final int? keptFromOriginal;

  /// True when the remix had to rebuild the look from scratch.
  final bool regenerated;

  /// Server creation time, used by the outfit history list.
  final DateTime? createdAt;
}

/// A single row in the AI stylist conversation.
@immutable
class ChatMessage {
  const ChatMessage({
    required this.fromUser,
    required this.text,
    this.outfit,
    this.source,
    this.followUp,
    this.match,
  });

  final bool fromUser;
  final String text;
  final Outfit? outfit;

  /// Which engine answered: `gemini` / `groq` / `openrouter` / `openai`, or
  /// `rules` when no key is configured. Surfaced so the UI never implies an LLM
  /// answered when the rule engine did.
  final String? source;

  /// The stylist's suggested next question, from the LLM turn.
  final String? followUp;

  /// Set when the turn answered a reference photo
  /// (`POST /ai/match-outfit`).
  final OutfitMatch? match;
}

/// Result of matching a photographed outfit against the user's own wardrobe
/// (`POST /ai/match-outfit`, `backend/src/vision.js`).
@immutable
class OutfitMatch {
  const OutfitMatch({
    required this.title,
    required this.occasion,
    required this.notes,
    required this.matches,
    required this.gaps,
    required this.similarity,
    required this.averageMatch,
    required this.wearable,
    required this.exactCount,
    this.outfit,
    this.source = '',
  });

  /// Title of the reference look as read by the vision model.
  final String title;
  final String occasion;
  final String notes;

  /// Per-slot results, in reference order.
  final List<SlotMatch> matches;

  /// Slots the wardrobe cannot fill (or fills poorly).
  final List<SlotGap> gaps;

  /// 0..100 — how close the assembled look is to the reference.
  final int similarity;

  /// 0..100 — mean per-slot match score.
  final int averageMatch;

  /// True when every required slot is filled, so the look is wearable.
  final bool wearable;
  final int exactCount;

  /// Scored assembly of the matched pieces, when two or more were found.
  final Outfit? outfit;
  final String source;
}

/// One slot of a reference look matched against the wardrobe.
@immutable
class SlotMatch {
  const SlotMatch({
    required this.slotLabel,
    required this.requestedGarment,
    required this.itemName,
    required this.image,
    required this.score,
    required this.exact,
    required this.closeEnough,
    required this.reason,
  });

  final String slotLabel;
  final String requestedGarment;

  /// Empty when nothing in the wardrobe fills the slot.
  final String itemName;
  final String image;
  final int score;

  /// True when the wardrobe hit the reference exactly.
  final bool exact;
  final bool closeEnough;
  final String reason;
}

/// A slot the wardrobe cannot fill properly.
@immutable
class SlotGap {
  const SlotGap({
    required this.slotLabel,
    required this.missing,
    required this.color,
    required this.material,
    required this.reason,
  });

  final String slotLabel;

  /// The garment described by the reference look, e.g. "Leather jacket".
  final String missing;
  final String color;
  final String material;
  final String reason;
}

/// A garment recommendation produced by the shopping assistant.
@immutable
class ShoppingPick {
  const ShoppingPick({
    required this.name,
    required this.price,
    required this.image,
    required this.reason,
    this.wishlisted = false,
  });

  final String name;
  final String price;
  final String image;
  final String reason;
  final bool wishlisted;
}

/// A packed item in the travel planner.
@immutable
class PackingEntry {
  const PackingEntry({
    required this.name,
    required this.image,
    this.packed = true,
  });

  final String name;
  final String image;
  final bool packed;
}

/// One day of the outfit planner.
@immutable
class PlanDay {
  const PlanDay({
    required this.weekday,
    required this.date,
    required this.occasion,
    required this.outfitName,
    required this.image,
    this.isToday = false,
  });

  final String weekday;
  final String date;
  final String occasion;
  final String outfitName;
  final String image;
  final bool isToday;
}

/// A single style-DNA segment.
@immutable
class StyleSegment {
  const StyleSegment({
    required this.label,
    required this.share,
    required this.color,
  });

  final String label;
  final int share;
  final Color color;
}

/// A named colour with a swatch and an item count.
@immutable
class StyleColor {
  const StyleColor({required this.name, required this.value, this.count});

  final String name;
  final int value;
  final int? count;
}

/// A wardrobe category row on the Style DNA screen.
@immutable
class StyleCategory {
  const StyleCategory({
    required this.name,
    required this.icon,
    required this.count,
  });

  final String name;
  final String icon;
  final int count;
}

/// The DB-backed Style DNA payload (`GET /insights/style-dna`).
@immutable
class StyleDna {
  const StyleDna({
    required this.segments,
    required this.colors,
    required this.categories,
    required this.evolution,
    required this.evolutionMonths,
    this.confidence = 0,
    this.archetype,
  });

  static const empty = StyleDna(
    segments: [],
    colors: [],
    categories: [],
    evolution: [],
    evolutionMonths: [],
  );

  final List<StyleSegment> segments;
  final List<StyleColor> colors;
  final List<StyleCategory> categories;
  final List<double> evolution;
  final List<String> evolutionMonths;
  final double confidence;
  final String? archetype;

  bool get isEmpty =>
      segments.isEmpty && colors.isEmpty && categories.isEmpty;
}

/// Editorial trend card on Discover.
@immutable
class DiscoverTrend {
  const DiscoverTrend({
    required this.name,
    required this.tag,
    required this.image,
  });

  final String name;
  final String tag;
  final String image;
}

/// Community look on Discover.
@immutable
class CommunityLook {
  const CommunityLook({
    required this.name,
    required this.likes,
    required this.image,
  });

  final String name;
  final int likes;
  final String image;
}

/// Discover payload served from the database.
@immutable
class DiscoverContent {
  const DiscoverContent({
    required this.trends,
    required this.looks,
  });

  static const empty = DiscoverContent(trends: [], looks: []);

  final List<DiscoverTrend> trends;
  final List<CommunityLook> looks;

  bool get isEmpty => trends.isEmpty && looks.isEmpty;
}

// ----------------------------------------------------------------- profile

/// The signed-in account plus its editable style blueprint.
///
/// Mirrors `GET /users/me` on the backend, where the subject is always resolved
/// from the bearer token — the client never sends a user id. Every field other
/// than [id] is either read-only (email, createdAt) or editable through
/// the `styleProfileToJson` mapper / [copyWith].
@immutable
class UserProfile {
  const UserProfile({
    required this.id,
    required this.name,
    required this.email,
    required this.createdAt,
    this.avatarUrl,
    this.favoriteColors = const [],
    this.preferredStyles = const [],
    this.heightCm,
    this.weightKg,
    this.fitPreference = 'regular',
    this.topSize,
    this.bottomSize,
    this.shoeSize,
  });

  final String id;
  final String name;
  final String email;

  /// Account creation time from the backend, used for "Member since".
  final DateTime? createdAt;

  /// Optional remote avatar. Null falls back to the bundled placeholder.
  final String? avatarUrl;

  final List<String> favoriteColors;
  final List<String> preferredStyles;
  final int? heightCm;
  final int? weightKg;

  /// One of slim | regular | relaxed | oversized.
  final String fitPreference;

  final String? topSize;
  final String? bottomSize;
  final String? shoeSize;

  /// "Member since Sep 2026", derived from [createdAt] — never a hardcoded
  /// string. Returns null when the backend sent no timestamp.
  String? get memberSince {
    final at = createdAt;
    if (at == null) return null;
    const months = [
      'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
    ];
    return 'Member since ${months[at.month - 1]} ${at.year}';
  }

  /// Initials for the avatar fallback.
  String get initials {
    final parts = name.trim().split(RegExp(r'\s+'));
    if (parts.isEmpty || parts.first.isEmpty) return '?';
    if (parts.length == 1) return parts.first[0].toUpperCase();
    return (parts.first[0] + parts.last[0]).toUpperCase();
  }

  /// The first name, used for the avatar fallback and greetings.
  String get firstName => name.trim().split(RegExp(r'\s+')).first;

  /// "178 cm", or null when the user has not set a height.
  String? get heightLabel => heightCm == null ? null : '$heightCm cm';

  /// "Medium (M)" style summary, preferring the top size then the bottom one.
  String? get sizeLabel {
    final top = topSize;
    if (top != null) return '${_sizeName(top)} ($top)';
    final bottom = bottomSize;
    if (bottom != null) return 'Waist $bottom';
    return null;
  }

  static String _sizeName(String size) => switch (size) {
        'XS' => 'Extra Small',
        'S' => 'Small',
        'M' => 'Medium',
        'L' => 'Large',
        'XL' => 'Extra Large',
        'XXL' => 'Double Extra Large',
        _ => size,
      };

  /// Body & fit line shown under the specs tiles.
  String? get fitLabel => switch (fitPreference) {
        'slim' => 'Slim fit',
        'regular' => 'Regular fit',
        'relaxed' => 'Relaxed fit',
        'oversized' => 'Oversized fit',
        _ => null,
      };

  /// Human readable weight, e.g. "72 kg".
  String? get weightLabel => weightKg == null ? null : '$weightKg kg';

  UserProfile copyWith({
    String? name,
    String? email,
    String? avatarUrl,
    List<String>? favoriteColors,
    List<String>? preferredStyles,
    int? heightCm,
    int? weightKg,
    String? fitPreference,
    String? topSize,
    String? bottomSize,
    String? shoeSize,
  }) =>
      UserProfile(
        id: id,
        name: name ?? this.name,
        email: email ?? this.email,
        createdAt: createdAt,
        avatarUrl: avatarUrl ?? this.avatarUrl,
        favoriteColors: favoriteColors ?? this.favoriteColors,
        preferredStyles: preferredStyles ?? this.preferredStyles,
        heightCm: heightCm ?? this.heightCm,
        weightKg: weightKg ?? this.weightKg,
        fitPreference: fitPreference ?? this.fitPreference,
        topSize: topSize ?? this.topSize,
        bottomSize: bottomSize ?? this.bottomSize,
        shoeSize: shoeSize ?? this.shoeSize,
      );

}
