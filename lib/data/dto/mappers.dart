import 'dart:ui';

import '../models.dart';
import '../assets.dart';

/// JSON boundary for the wardrobe API (§8.3).
///
/// Domain models stay mapping-free so they can be constructed in tests and UI
/// previews without a backend payload. Every default lives here, next to the
/// wire format it belongs to.
ClothingItem clothingItemFromJson(Map<String, dynamic> json) {
  // The wardrobe API nests the vision provenance under the item's `legacy`
  // JSON column (§8.3); older responses carried the same keys flattened.
  final legacy = json['legacy'] is Map
      ? Map<String, dynamic>.from(json['legacy'] as Map)
      : json;
  final rejected = legacy['analysisRejected'];
  return ClothingItem(
    id: '${json['id'] ?? ''}',
    name: '${json['name'] ?? 'Untitled'}',
    image: '${json['image'] ?? json['imageUrl'] ?? Img.teeWhite}',
    category: '${json['category'] ?? 'Tops'}',
    color: '${json['color'] ?? 'White'}',
    style: '${json['style'] ?? 'Casual'}',
    material: '${json['material'] ?? 'Cotton'}',
    season: '${json['season'] ?? 'All Season'}',
    formality: '${json['formality'] ?? 'Casual'}',
    pattern: '${json['pattern'] ?? 'Plain'}',
    timesWorn: (json['timesWorn'] as num?)?.toInt() ?? 0,
    lastWornLabel: json['lastWornLabel'] as String?,
    analysisSource: legacy['analysisSource'] as String?,
    analysisConfidence: (legacy['analysisConfidence'] as num?)?.toDouble(),
    // One bundle for the detail card: the vision payload plus the rejection
    // reason when the gate refused the image. Null when nothing was analyzed.
    analysisRaw: (legacy['analysis'] is Map || rejected is Map)
        ? <String, dynamic>{
            if (legacy['analysis'] is Map)
              ...Map<String, dynamic>.from(legacy['analysis'] as Map),
            if (rejected is Map) ...Map<String, dynamic>.from(rejected),
            if (legacy['uncertainAttributes'] is List)
              'uncertainAttributes': legacy['uncertainAttributes'],
          }
        : null,
    analysisRejected: rejected != null && rejected != false,
    analyzedAt: DateTime.tryParse('${legacy['analyzedAt'] ?? ''}'),
    gender: json['gender'] is String && (json['gender'] as String).isNotEmpty
        ? json['gender'] as String
        : null,
  );
}

Map<String, dynamic> clothingItemToJson(ClothingItem item) => {
      'id': item.id,
      'name': item.name,
      'image': item.image,
      'category': item.category,
      'color': item.color,
      'style': item.style,
      'material': item.material,
      'season': item.season,
      'formality': item.formality,
      'timesWorn': item.timesWorn,
      if (item.lastWornLabel != null) 'lastWornLabel': item.lastWornLabel,
    };

/// One scored factor of the 11-factor compatibility engine (§8.5).
MatchFactor matchFactorFromJson(Map<String, dynamic> json) => MatchFactor(
      key: '${json['key'] ?? ''}',
      label: '${json['label'] ?? ''}',
      value: (json['value'] as num?)?.toInt() ?? 0,
      weight: (json['weight'] as num?)?.toDouble() ?? 0,
      applied: json['applied'] != false,
      contribution: (json['contribution'] as num?)?.toDouble() ?? 0,
    );

/// A saved or AI-generated outfit (§8.5).
Outfit outfitFromJson(Map<String, dynamic> json) => Outfit(
      id: '${json['id'] ?? ''}',
      name: '${json['name'] ?? 'Untitled look'}',
      image: '${json['image'] ?? json['imageUrl'] ?? Img.outfitFlatlayBeige}',
      occasion: '${json['occasion'] ?? 'Casual'}',
      match: ((json['match'] ?? json['matchScore']) as num?)?.toInt() ?? 85,
      pieces: [
        for (final p in (json['pieces'] as List? ?? const [])) '$p',
      ],
      summary: json['summary'] as String?,
      itemIds: [
        for (final p in (json['itemIds'] as List? ?? const [])) '$p',
      ],
      breakdown: [
        for (final b in (json['breakdown'] as List? ?? const []))
          if (b is Map)
            (
              label: '${b['label'] ?? ''}',
              value: ((b['value'] ?? 0) as num?)?.toInt() ?? 0,
            ),
      ],
      factors: [
        for (final b in (json['breakdown'] as List? ?? const []))
          if (b is Map) matchFactorFromJson(Map<String, dynamic>.from(b)),
      ],
      explanation: json['explanation'] as String?,
      favorite: json['favorite'] == true,
      completeness: (json['completeness'] as num?)?.toDouble(),
      variant: json['variant'] as String?,
      note: json['note'] as String?,
      keptFromOriginal: (json['keptFromOriginal'] as num?)?.toInt(),
      regenerated: json['regenerated'] == true,
      createdAt: DateTime.tryParse('${json['createdAt'] ?? ''}')?.toLocal(),
    );

/// Discover editorial content served by `GET /content/discover`.
DiscoverContent discoverContentFromJson(Map<String, dynamic> json) {
  return DiscoverContent(
    trends: [
      for (final row in (json['trendingStyles'] as List? ?? const []))
        if (row is Map)
          DiscoverTrend(
            name: '${row['name'] ?? ''}',
            tag: '${row['tag'] ?? ''}',
            image: '${row['image'] ?? Img.trendMinimalSummer}',
          ),
    ],
    looks: [
      for (final row in (json['communityLooks'] as List? ?? const []))
        if (row is Map)
          CommunityLook(
            name: '${row['name'] ?? ''}',
            likes: (row['likes'] as num?)?.toInt() ?? 0,
            image: '${row['image'] ?? Img.communityUrban}',
          ),
    ],
  );
}

/// Style DNA payload from `GET /insights/style-dna`.
StyleDna styleDnaFromJson(Map<String, dynamic> json) {
  final evolution = [
    for (final row in (json['evolution'] as List? ?? const []))
      (row as num?)?.toDouble() ?? 0,
  ];
  return StyleDna(
    segments: [
      for (final row in (json['segments'] as List? ?? const []))
        if (row is Map)
          StyleSegment(
            label: '${row['label'] ?? ''}',
            share: (row['share'] as num?)?.toInt() ?? 0,
            color: Color(_hexValue('${row['color'] ?? ''}')),
          ),
    ],
    colors: [
      for (final row in (json['colors'] as List? ?? const []))
        if (row is Map)
          StyleColor(
            name: '${row['name'] ?? ''}',
            value: _hexValue('${row['value'] ?? ''}'),
            count: (row['count'] as num?)?.toInt(),
          ),
    ],
    categories: [
      for (final row in (json['categories'] as List? ?? const []))
        if (row is Map)
          StyleCategory(
            name: '${row['name'] ?? ''}',
            icon: '${row['icon'] ?? 'shirt'}',
            count: (row['count'] as num?)?.toInt() ?? 0,
          ),
    ],
    evolution: evolution,
    evolutionMonths: [
      for (final row in (json['evolutionMonths'] as List? ?? const []))
        '$row',
    ],
    confidence: (json['confidence'] as num?)?.toDouble() ?? 0,
    archetype: json['archetype'] as String?,
  );
}

int _hexValue(String raw) {
  var value = raw.trim().replaceFirst('#', '');
  if (value.length == 6) value = 'FF$value';
  return int.tryParse(value, radix: 16) ?? 0xFF1E1C1A;
}


/// Result of matching a photographed look against the wardrobe (`/ai/match-outfit`).
OutfitMatch outfitMatchFromJson(Map<String, dynamic> json) {
  final outfit = json['outfit'];
  return OutfitMatch(
    title: '${(json['reference'] as Map?)?['title'] ?? 'Reference outfit'}',
    occasion: '${(json['reference'] as Map?)?['occasion'] ?? ''}',
    notes: '${(json['reference'] as Map?)?['notes'] ?? ''}',
    matches: [
      for (final m in (json['matches'] as List? ?? const []))
        if (m is Map) _slotMatchFromJson(Map<String, dynamic>.from(m)),
    ],
    gaps: [
      for (final g in (json['gaps'] as List? ?? const []))
        if (g is Map) _slotGapFromJson(Map<String, dynamic>.from(g)),
    ],
    similarity: (json['similarity'] as num?)?.toInt() ?? 0,
    averageMatch: (json['averageMatch'] as num?)?.toInt() ?? 0,
    wearable: json['wearable'] == true,
    exactCount: (json['exactCount'] as num?)?.toInt() ?? 0,
    outfit: outfit is Map
        ? outfitFromJson(Map<String, dynamic>.from(outfit))
        : null,
    source: '${json['source'] ?? ''}',
  );
}

SlotMatch _slotMatchFromJson(Map<String, dynamic> json) {
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

SlotGap _slotGapFromJson(Map<String, dynamic> json) => SlotGap(
      slotLabel: '${json['slotLabel'] ?? ''}',
      missing: '${json['missing'] ?? ''}',
      color: '${json['color'] ?? ''}',
      material: '${json['material'] ?? ''}',
      reason: '${json['reason'] ?? ''}',
    );

/// `/users/me` payload. Tolerant by design: a missing style profile or a null
/// measurement renders as "not set" rather than throwing.
UserProfile userProfileFromJson(Map<String, dynamic> json) {
  final style =
      (json['styleProfile'] as Map?)?.cast<String, dynamic>() ?? const {};
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
    gender: _genderOrNull(style['gender']),
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
Map<String, dynamic> styleProfileToJson(UserProfile profile) => {
      'gender': profile.gender,
      'favoriteColors': profile.favoriteColors,
      'preferredStyles': profile.preferredStyles,
      'heightCm': profile.heightCm,
      'weightKg': profile.weightKg,
      'fitPreference': profile.fitPreference,
      'sizes': {
        'top': profile.topSize,
        'bottom': profile.bottomSize,
        'shoe': profile.shoeSize,
      },
    };

String? _genderOrNull(Object? value) {
  final v = '${value ?? ''}'.trim().toLowerCase();
  return (v == 'male' || v == 'female') ? v : null;
}

List<String> _strings(Object? value) => [
      for (final v in (value as List? ?? const [])) '$v'.trim(),
    ].where((v) => v.isNotEmpty).toList();

int? _intOrNull(Object? value) {
  if (value is num) return value.toInt();
  return int.tryParse('${value ?? ''}'.trim());
}

String? _nullIfEmpty(Object? value) {
  final text = '${value ?? ''}'.trim();
  return text.isEmpty ? null : text;
}
