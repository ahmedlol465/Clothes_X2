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
        timesWorn: (json['timesWorn'] as num?)?.toInt() ?? 0,
        lastWornLabel: json['lastWornLabel'] as String?,
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
        'timesWorn': timesWorn,
        if (lastWornLabel != null) 'lastWornLabel': lastWornLabel,
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
    this.explanation,
    this.favorite = false,
  });

  final String id;
  final String name;
  final String image;
  final String occasion;
  final int match;

  /// Names of the garments combined into this outfit.
  final List<String> pieces;
  final String? summary;

  /// Backend outfit fields (§8.5). Null when the outfit is a local mock.
  final List<String>? itemIds;
  final List<({String label, int value})>? breakdown;
  final String? explanation;
  final bool favorite;

  /// JSON mapping for the backend outfits API (§8.5).
  factory Outfit.fromJson(Map<String, dynamic> json) => Outfit(
        id: '${json['id'] ?? ''}',
        name: '${json['name'] ?? 'Untitled look'}',
        image: '${json['image'] ?? 'assets/images/outfit_flatlay_beige.jpg'}',
        occasion: '${json['occasion'] ?? 'Casual'}',
        match: (json['match'] as num?)?.toInt() ?? 85,
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
        explanation: json['explanation'] as String?,
        favorite: json['favorite'] == true,
      );
}

/// A single row in the AI stylist conversation.
@immutable
class ChatMessage {
  const ChatMessage({required this.fromUser, required this.text, this.outfit});

  final bool fromUser;
  final String text;
  final Outfit? outfit;
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
