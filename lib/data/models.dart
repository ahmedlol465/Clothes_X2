import 'package:flutter/widgets.dart';

double? _asDoubleOrNull(Object? value) {
  if (value is num) return value.toDouble();
  return null;
}

Map<String, dynamic>? _asMapOrNull(Object? value) =>
    value is Map ? Map<String, dynamic>.from(value) : null;

/// Read factors from the explicit `factors` field, falling back to deriving
/// from `breakdown` for older payloads that predate the explicit field.
List<MatchFactor> _factorsFromJson(Map<String, dynamic> json) {
  if (json['factors'] is List && (json['factors'] as List).isNotEmpty) {
    return [
      for (final b in (json['factors'] as List))
        if (b is Map)
          MatchFactor.fromJson(Map<String, dynamic>.from(b)),
    ];
  }
  return [
    for (final b in (json['breakdown'] as List? ?? const []))
      if (b is Map)
        MatchFactor.fromJson(Map<String, dynamic>.from(b)),
  ];
}

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
    this.pattern = 'Plain',
    this.timesWorn = 0,
    this.lastWornLabel,
    // AI analysis provenance (§8.4). Populated by the backend when a garment
    // was created through a real photo analysis (`POST /wardrobe/items`
    // returns these fields); null for mock/demo items or items added before
    // this upgrade. The server owns these values — the client only reads them.
    this.analysisSource,
    this.analysisConfidence,
    this.analysisRaw,
    this.analysisRejected = false,
    this.analyzedAt,
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

  /// Shopper-style pattern detected from the image (e.g. "Plain", "Striped").
  /// Defaults to the backend's fallback so existing items keep a value.
  final String pattern;

  final int timesWorn;
  final String? lastWornLabel;

  /// Who produced the analysis: `clothing-vision`, `clothing-vision+gemini`,
  /// `filename` (unverified guess from the name), `heuristic` (offline
  /// fallback), or null when no analysis exists.
  final String? analysisSource;

  /// Honest 0..1 confidence from the vision pipeline (agreement x attribute
  /// certainty). Null when the garment was not analyzed.
  final double? analysisConfidence;

  /// The full raw analysis payload from the backend, kept so the detail
  /// screen can show color detail, evidence and the model identity.
  final Map<String, dynamic>? analysisRaw;

  /// True when the backend's gate rejected the image as non-clothing. The
  /// item may still be stored (the user may know better), but the UI must say
  /// so instead of showing default tags as fact.
  final bool analysisRejected;

  /// When the analysis was performed (ISO-8601), or null.
  final DateTime? analyzedAt;

  /// Compact "Tops • White" style summary used under the product name.
  String get meta => '$category • $color';

  /// How the analysis turned out. `null` when there is no analysis record.
  String? get analysisStatus {
    if (analysisRejected) return 'rejected';
    if (analysisSource == null) return null;
    if (analysisSource == 'heuristic') return 'heuristic';
    if (analysisSource == 'filename') return 'filename';
    if (analysisConfidence != null && analysisConfidence! < 0.5) {
      return 'uncertain';
    }
    return 'analyzed';
  }

  /// Human read-out of [analysisStatus], or null when there is nothing to say.
  String? get analysisStatusLabel {
    switch (analysisStatus) {
      case 'rejected':
        return 'Rejected by the AI gate — not detected as clothing.';
      case 'heuristic':
        return 'Analyzed offline — tags are best-guess defaults.';
      case 'filename':
        return 'Unverified — tags guessed from the file name.';
      case 'uncertain':
        return 'Analyzed with low confidence — verify the tags below.';
      case 'analyzed':
        return 'Analyzed by AI vision.';
      default:
        return null;
    }
  }

  /// The named colour plus its measured confidence when available.
  String? get colorWithConfidence {
    if (color.isEmpty) return null;
    final conf = analysisConfidence;
    if (conf == null) return color;
    return '$color (${(conf * 100).round()}%)';
  }

  /// Attributes the model was not confident about, e.g. ['material', 'season'].
  List<String> get uncertainAttributesList {
    final raw = analysisRaw?['uncertainAttributes'];
    if (raw is List) return raw.whereType<String>().toList();
    return const <String>[];
  }

  /// JSON mapping for the backend wardrobe API (§8.3).
  factory ClothingItem.fromJson(Map<String, dynamic> json) => ClothingItem(
        id: '${json['id'] ?? ''}',
        name: '${json['name'] ?? 'Untitled'}',
        image: '${json['image'] ?? 'assets/images/item_tee_white.jpg'}',
        category: '${json['category'] ?? 'Tops'}',
        color: '${json['color'] ?? 'White'}',
        style: '${json['style'] ?? 'Casual'}',
        material: '${json['material'] ?? 'Cotton'}',
        season: '${json['season'] ?? 'All Season'}',
        formality: '${json['formality'] ?? 'Casual'}',
        pattern: '${json['pattern'] ?? 'Plain'}',
        timesWorn: (json['timesWorn'] as num?)?.toInt() ?? 0,
        lastWornLabel: json['lastWornLabel'] as String?,
        analysisSource: json['analysisSource'] as String?,
        analysisConfidence: (json['analysisConfidence'] as num?)?.toDouble(),
        analysisRaw: json['analysis'] is Map
            ? Map<String, dynamic>.from(json['analysis'] as Map)
            : null,
        analysisRejected: json['analysisRejected'] == true,
        analyzedAt: DateTime.tryParse('${json['analyzedAt'] ?? ''}'),
      );

  Map<String, dynamic> toJson() => {
        'id': id,
        'name': name,
        'image': image,
        'category': category,
        'color': color,
        'style': style,
        'material': material,
        'season': season,
        'formality': formality,
        'pattern': pattern,
        'timesWorn': timesWorn,
        if (lastWornLabel != null) 'lastWornLabel': lastWornLabel,
        if (analysisSource != null) 'analysisSource': analysisSource,
        if (analysisConfidence != null)
          'analysisConfidence': analysisConfidence,
        if (analysisRaw != null) 'analysis': analysisRaw,
        if (analysisRejected) 'analysisRejected': true,
        if (analyzedAt != null) 'analyzedAt': analyzedAt?.toIso8601String(),
      };

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

  factory MatchFactor.fromJson(Map<String, dynamic> json) => MatchFactor(
        key: '${json['key'] ?? ''}',
        label: '${json['label'] ?? ''}',
        value: (json['value'] as num?)?.toInt() ?? 0,
        weight: (json['weight'] as num?)?.toDouble() ?? 0,
        applied: json['applied'] != false,
        contribution: (json['contribution'] as num?)?.toDouble() ?? 0,
      );

  /// Matches the legacy `(label, value)` shape used by the mock data.
  ({String label, int value}) get row => (label: label, value: value);

  /// The backend shape `POST /outfits` accepts for a persisted breakdown, so a
  /// saved recommendation keeps the exact report the user was shown instead of
  /// the backend re-deriving a different one.
  Map<String, dynamic> toJson() => {
        'key': key,
        'label': label,
        'value': value,
        'weight': weight,
        'applied': applied,
        'contribution': contribution,
      };
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
    this.compatibilityScore,
    this.rankingScore,
    this.summary,
    this.itemIds,
    this.breakdown,
    this.factors,
    this.explanation,
    this.favorite = false,
    this.completeness,
    this.completenessDetail,
    this.variant,
    this.note,
    this.keptFromOriginal,
    this.regenerated = false,
    this.provenance,
    this.grounding,
  });

  final String id;
  final String name;
  final String image;
  final String occasion;

  /// Backend legacy field. On recommended looks it is a backward-compatible
  /// alias of [compatibilityScore]; on old/local outfits it is the score.
  final int match;

  /// The explained 11-factor compatibility score the UI should display.
  /// Null on old/local outfits, where [match] is the compatibility itself.
  final int? compatibilityScore;

  /// The engine's internal ordering score for recommended looks. It may differ
  /// from [match]/[compatibilityScore] and must never label the Match %.
  final int? rankingScore;

  /// The number that labels the outfit as a compatibility percentage.
  int get displayMatch => compatibilityScore ?? match;

  /// Names of the garments combined into this outfit.
  final List<String> pieces;
  final String? summary;

  /// Backend outfit fields (§8.5). Null when the outfit is a local mock.
  final List<String>? itemIds;
  final List<({String label, int value})>? breakdown;

  /// Full 11-factor report with weights and signal flags. Preferred over
  /// [breakdown] wherever the UI can show which factors actually counted.
  final List<MatchFactor>? factors;
  final String? explanation;
  final bool favorite;

  /// Completeness of the look (0..1) from the scoring engine's gate.
  final double? completeness;

  /// Additive detailed completeness gate (`{ratio, filled, required}`).
  /// Old servers sent this object as [completeness] itself; it is preserved
  /// here so that payload still parses.
  final Map<String, dynamic>? completenessDetail;

  /// How the outfit was produced (`llm_ids`, `recovered_from_reply`,
  /// `generated_fallback`, `rule_fallback`, `generated`, `match`, `remix`).
  final String? provenance;

  /// How the outfit relates to the reply/wardrobe
  /// (`{recoveredItemIds, usedFallback, allOwned}`).
  final Map<String, dynamic>? grounding;

  /// Remix variant key (`casual`, `cold`, `summer`, `date`, `formal`).
  final String? variant;

  /// Set by `/ai/remix` when the original outfit already suits the context.
  final String? note;

  /// How many pieces of the submitted outfit survived the remix.
  final int? keptFromOriginal;

  /// True when the remix had to rebuild the look from scratch.
  final bool regenerated;

  /// JSON mapping for the backend outfits API (§8.5).
  factory Outfit.fromJson(Map<String, dynamic> json) {
    final completenessRaw = json['completeness'];
    final completenessDetail = _asMapOrNull(json['completenessDetail']) ??
        (completenessRaw is Map
            ? Map<String, dynamic>.from(completenessRaw)
            : null);
    final completenessNumber = _asDoubleOrNull(completenessRaw) ??
        _asDoubleOrNull(completenessDetail?['ratio']);
    return Outfit(
      id: '${json['id'] ?? ''}',
      name: '${json['name'] ?? 'Untitled look'}',
      image: '${json['image'] ?? 'assets/images/outfit_flatlay_beige.jpg'}',
      occasion: '${json['occasion'] ?? 'Casual'}',
      match: (json['match'] as num?)?.toInt() ?? 85,
      compatibilityScore: (json['compatibilityScore'] as num?)?.toInt(),
      rankingScore: (json['rankingScore'] as num?)?.toInt(),
      pieces: [
        for (final p in (json['pieces'] as List? ?? const [])) '$p',
      ],
      summary: json['summary'] as String?,
      itemIds: [
        for (final p in (json['itemIds'] as List? ?? const [])) '$p',
      ],
      breakdown: [
        for (final b in (json['breakdown'] as List? ?? const []))
          (
            label: '${b['label'] ?? ''}',
            value: (b['value'] ?? 0).toInt(),
          ),
      ],
      // Prefer the explicit factors the backend now sends (with weight,
      // applied and contribution) so the UI can show what actually moved the
      // score. Fall back to deriving from breakdown for older payloads.
      factors: _factorsFromJson(json),
      explanation: json['explanation'] as String?,
      favorite: json['favorite'] == true,
      completeness: completenessNumber,
      completenessDetail: completenessDetail,
      variant: json['variant'] as String?,
      note: json['note'] as String?,
      keptFromOriginal: (json['keptFromOriginal'] as num?)?.toInt(),
      regenerated: json['regenerated'] == true,
      provenance: json['provenance'] is String ? json['provenance'] as String : null,
      grounding: _asMapOrNull(json['grounding']),
    );
  }
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

  factory OutfitMatch.fromJson(Map<String, dynamic> json) {
    final outfit = json['outfit'];
    return OutfitMatch(
      title: '${(json['reference'] as Map?)?['title'] ?? 'Reference outfit'}',
      occasion: '${(json['reference'] as Map?)?['occasion'] ?? ''}',
      notes: '${(json['reference'] as Map?)?['notes'] ?? ''}',
      matches: [
        for (final m in (json['matches'] as List? ?? const []))
          if (m is Map) SlotMatch.fromJson(Map<String, dynamic>.from(m)),
      ],
      gaps: [
        for (final g in (json['gaps'] as List? ?? const []))
          if (g is Map) SlotGap.fromJson(Map<String, dynamic>.from(g)),
      ],
      similarity: (json['similarity'] as num?)?.toInt() ?? 0,
      averageMatch: (json['averageMatch'] as num?)?.toInt() ?? 0,
      wearable: json['wearable'] == true,
      exactCount: (json['exactCount'] as num?)?.toInt() ?? 0,
      outfit: outfit is Map
          ? Outfit.fromJson(Map<String, dynamic>.from(outfit))
          : null,
      source: '${json['source'] ?? ''}',
    );
  }
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

  factory SlotMatch.fromJson(Map<String, dynamic> json) {
    final item = json['item'] is Map
        ? Map<String, dynamic>.from(json['item'] as Map)
        : null;
    final request = json['request'] is Map
        ? Map<String, dynamic>.from(json['request'] as Map)
        : null;
    return SlotMatch(
      slotLabel: '${json['slotLabel'] ?? ''}',
      requestedGarment: '${request?['garment'] ?? ''}',
      itemName: '${item?['name'] ?? ''}',
      image: '${item?['image'] ?? ''}',
      score: (json['score'] as num?)?.toInt() ?? 0,
      exact: json['exact'] == true,
      closeEnough: json['closeEnough'] == true,
      reason: '${json['reason'] ?? ''}',
    );
  }
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

  factory SlotGap.fromJson(Map<String, dynamic> json) => SlotGap(
        slotLabel: '${json['slotLabel'] ?? ''}',
        missing: '${json['missing'] ?? ''}',
        color: '${json['color'] ?? ''}',
        material: '${json['material'] ?? ''}',
        reason: '${json['reason'] ?? ''}',
      );
}

/// A wardrobe gap entry: a missing category, what to add, and what it unlocks.
@immutable
class WardrobeGapEntry {
  const WardrobeGapEntry({
    required this.gap,
    required this.suggestion,
    required this.reason,
    required this.unlocks,
  });

  final String gap;
  final String suggestion;
  final String reason;
  final List<String> unlocks;

  factory WardrobeGapEntry.fromJson(Map<String, dynamic> json) => WardrobeGapEntry(
        gap: '${json['gap'] ?? ''}',
        suggestion: '${json['suggestion'] ?? ''}',
        reason: '${json['reason'] ?? ''}',
        unlocks: List<String>.from((json['unlocks'] as List? ?? const [])),
      );
}

/// Occasion coverage: whether the wardrobe can build an outfit for a context.
@immutable
class WardrobeGapCoverage {
  const WardrobeGapCoverage({
    required this.occasion,
    required this.covered,
    required this.match,
  });

  final String occasion;
  final bool covered;
  final int match;

  factory WardrobeGapCoverage.fromJson(Map<String, dynamic> json) =>
      WardrobeGapCoverage(
        occasion: '${json['occasion'] ?? ''}',
        covered: json['covered'] == true,
        match: (json['match'] as num?)?.toInt() ?? 0,
      );
}

/// Wardrobe gap analysis from `POST /ai/wardrobe-gap` and recommendation meta.
@immutable
class WardrobeGap {
  const WardrobeGap({
    required this.gaps,
    required this.totalItems,
    required this.byCategory,
    required this.coverage,
    required this.health,
  });

  final List<WardrobeGapEntry> gaps;
  final int totalItems;
  final Map<String, dynamic> byCategory;
  final List<WardrobeGapCoverage> coverage;
  final Map<String, dynamic> health;

  factory WardrobeGap.fromJson(Map<String, dynamic> json) => WardrobeGap(
        gaps: [
          for (final g in (json['gaps'] as List? ?? const []))
            if (g is Map) WardrobeGapEntry.fromJson(Map<String, dynamic>.from(g)),
        ],
        totalItems: (json['totalItems'] as num?)?.toInt() ?? 0,
        byCategory: Map<String, dynamic>.from(json['byCategory'] ?? const {}),
        coverage: [
          for (final c in (json['coverage'] as List? ?? const []))
            if (c is Map) WardrobeGapCoverage.fromJson(Map<String, dynamic>.from(c)),
        ],
        health: Map<String, dynamic>.from(json['health'] ?? const {}),
      );
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

// ----------------------------------------------------------------- profile

/// The signed-in account plus its editable style blueprint.
///
/// Mirrors `GET /users/me` on the backend, where the subject is always resolved
/// from the bearer token — the client never sends a user id. Every field other
/// than [id] is either read-only (email, createdAt) or editable through
/// [toStyleProfileJson] / [copyWith].
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

  /// Parses the `/users/me` payload. Tolerant by design: a missing style
  /// profile or a null measurement renders as "not set" rather than throwing.
  factory UserProfile.fromJson(Map<String, dynamic> json) {
    final style = (json['styleProfile'] as Map?)?.cast<String, dynamic>() ?? const {};
    final sizes = (style['sizes'] as Map?)?.cast<String, dynamic>() ?? const {};
    return UserProfile(
      id: '${json['id'] ?? ''}',
      name: '${json['name'] ?? ''}'.trim().isEmpty
          ? '${json['email'] ?? 'Member'}'
          : '${json['name']}'.trim(),
      email: '${json['email'] ?? ''}',
      createdAt: DateTime.tryParse('${json['createdAt'] ?? ''}')?.toLocal(),
      avatarUrl: json['avatarUrl'] == null
          ? null
          : '${json['avatarUrl']}'.trim().isEmpty
              ? null
              : '${json['avatarUrl']}',
      favoriteColors: _strings(style['favoriteColors']),
      preferredStyles: _strings(style['preferredStyles']),
      heightCm: _intOrNull(style['heightCm']),
      weightKg: _intOrNull(style['weightKg']),
      fitPreference: '${style['fitPreference'] ?? 'regular'}',
      topSize: _nullIfEmpty(sizes['top']),
      bottomSize: _nullIfEmpty(sizes['bottom']),
      shoeSize: _nullIfEmpty(sizes['shoe'] ?? sizes['shoes']),
    );
  }

  /// Only the editable style fields, shaped for `PATCH /users/me/style-profile`.
  Map<String, dynamic> toStyleProfileJson() => {
        'favoriteColors': favoriteColors,
        'preferredStyles': preferredStyles,
        'heightCm': heightCm,
        'weightKg': weightKg,
        'fitPreference': fitPreference,
        'sizes': {
          'top': topSize,
          'bottom': bottomSize,
          'shoe': shoeSize,
        },
      };

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

  static List<String> _strings(Object? value) => [
        for (final v in (value as List? ?? const [])) '$v'.trim(),
      ].where((v) => v.isNotEmpty).toList();

  static int? _intOrNull(Object? value) {
    if (value is num) return value.toInt();
    return int.tryParse('${value ?? ''}'.trim());
  }

  static String? _nullIfEmpty(Object? value) {
    final text = '${value ?? ''}'.trim();
    return text.isEmpty ? null : text;
  }
}

/// A single learned colour preference with its source and value (0..1).
@immutable
class ColorPreference {
  const ColorPreference({
    required this.name,
    required this.value,
    this.source,
  });

  final String name;
  final double value;
  final String? source;

  factory ColorPreference.fromJson(Map<String, dynamic> json) => ColorPreference(
        name: '${json['name'] ?? ''}',
        value: (json['value'] as num?)?.toDouble() ?? 0.5,
        source: '${json['source'] ?? ''}'.trim().isEmpty ? null : '${json['source']}',
      );
}

/// A single learned style preference with its source and value (0..1).
@immutable
class StylePreference {
  const StylePreference({
    required this.name,
    required this.value,
    this.source,
  });

  final String name;
  final double value;
  final String? source;

  factory StylePreference.fromJson(Map<String, dynamic> json) => StylePreference(
        name: '${json['name'] ?? ''}',
        value: (json['value'] as num?)?.toDouble() ?? 0.5,
        source: '${json['source'] ?? ''}'.trim().isEmpty ? null : '${json['source']}',
      );
}

/// A single learned fabric preference with its source and value (0..1).
@immutable
class FabricPreference {
  const FabricPreference({
    required this.name,
    required this.value,
    this.source,
  });

  final String name;
  final double value;
  final String? source;

  factory FabricPreference.fromJson(Map<String, dynamic> json) => FabricPreference(
        name: '${json['name'] ?? ''}',
        value: (json['value'] as num?)?.toDouble() ?? 0.5,
        source: '${json['source'] ?? ''}'.trim().isEmpty ? null : '${json['source']}',
      );
}

/// The full set of learned style preferences for the current user
/// (`GET /ai/preferences`).
@immutable
class LearnedPreferences {
  const LearnedPreferences({
    required this.userId,
    required this.colors,
    required this.styles,
    required this.fabrics,
    required this.occasions,
    required this.avoid,
    required this.facts,
    required this.itemRatings,
    required this.confidence,
    required this.totals,
    required this.updatedAt,
  });

  final String? userId;
  final Map<String, dynamic> colors;
  final Map<String, dynamic> styles;
  final Map<String, dynamic> fabrics;
  final Map<String, dynamic> occasions;
  final List<String> avoid;
  final List<Map<String, dynamic>> facts;
  final Map<String, dynamic> itemRatings;
  final double confidence;
  final Map<String, dynamic> totals;
  final String? updatedAt;

  /// Colour preferences as typed models, filtered to non-neutral values.
  List<ColorPreference> get colorPreferences => colors.entries
      .where((e) => e.value is num && (e.value as num).toDouble() != 0.5)
      .map((e) => ColorPreference(
            name: e.key,
            value: (e.value as num).toDouble(),
            source: 'learned',
          ))
      .toList();

  /// Style preferences as typed models, filtered to non-neutral values.
  List<StylePreference> get stylePreferences => styles.entries
      .where((e) => e.value is num && (e.value as num).toDouble() != 0.5)
      .map((e) => StylePreference(
            name: e.key,
            value: (e.value as num).toDouble(),
            source: 'learned',
          ))
      .toList();

  /// Fabric preferences as typed models, filtered to neutral values.
  List<FabricPreference> get fabricPreferences => fabrics.entries
      .where((e) => e.value is num && (e.value as num).toDouble() != 0.5)
      .map((e) => FabricPreference(
            name: e.key,
            value: (e.value as num).toDouble(),
            source: 'learned',
          ))
      .toList();

  /// Whether the user has stated a formality lean.
  bool get hasFormalityOpinion {
    final v = occasions['formal'];
    return v is num && v.toDouble() != 0.5;
  }

  /// The stated formality lean, or null when neutral.
  double? get formalityLean {
    final v = occasions['formal'];
    return v is num ? v.toDouble() : null;
  }

  factory LearnedPreferences.fromJson(Map<String, dynamic> json) =>
      LearnedPreferences(
        userId: '${json['userId'] ?? ''}'.trim().isEmpty ? null : '${json['userId']}',
        colors: Map<String, dynamic>.from(json['colors'] ?? const {}),
        styles: Map<String, dynamic>.from(json['styles'] ?? const {}),
        fabrics: Map<String, dynamic>.from(json['fabrics'] ?? const {}),
        occasions: Map<String, dynamic>.from(json['occasions'] ?? const {}),
        avoid: List<String>.from((json['avoid'] as List? ?? const [])),
        facts: List<Map<String, dynamic>>.from((json['facts'] as List? ?? const [])
            .map((f) => Map<String, dynamic>.from(f as Map))),
        itemRatings: Map<String, dynamic>.from(json['itemRatings'] ?? const {}),
        confidence: (json['confidence'] as num?)?.toDouble() ?? 0.0,
        totals: Map<String, dynamic>.from(json['totals'] ?? const {}),
        updatedAt: '${json['updatedAt'] ?? ''}'.trim().isEmpty ? null : '${json['updatedAt']}',
      );
}

/// User-controlled preference update payload for `PATCH /ai/preferences`.
@immutable
class PreferenceUpdate {
  const PreferenceUpdate({
    this.color,
    this.colorValue,
    this.style,
    this.styleValue,
    this.fabric,
    this.fabricValue,
    this.formality,
    this.avoid,
  });

  final String? color;
  final double? colorValue;
  final String? style;
  final double? styleValue;
  final String? fabric;
  final double? fabricValue;
  final String? formality;
  final String? avoid;

  Map<String, dynamic> toJson() => <String, dynamic>{
        if (color != null) 'color': color,
        if (colorValue != null) 'value': colorValue,
        if (style != null) 'style': style,
        if (styleValue != null) 'value': styleValue,
        if (fabric != null) 'fabric': fabric,
        if (fabricValue != null) 'value': fabricValue,
        if (formality != null) 'formality': formality,
        if (avoid != null) 'avoid': avoid,
      };
}
