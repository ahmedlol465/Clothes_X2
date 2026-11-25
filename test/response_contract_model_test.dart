import 'package:flutter_test/flutter_test.dart';
import 'package:smartwardrobe/data/dto/mappers.dart';

Map<String, dynamic> outfitJson() => {
      'id': 'gen-1',
      'name': 'Clean Tailoring',
      'image': 'assets/images/outfit.jpg',
      'occasion': 'casual',
      'match': 93,
      'breakdown': [
        {'label': 'Color Harmony', 'value': 90},
      ],
      'itemIds': ['w1', 'w11', 'w4'],
      'pieces': ['Oxford Cotton Shirt', 'Beige Chinos', 'Minimalist Sneakers'],
      'explanation': 'A calm palette.',
      'completeness': 1.0,
    };

void main() {
  group('outfitFromJson response contract', () {
    test('parses the canonical outfit payload', () {
      final outfit = outfitFromJson(outfitJson());

      expect(outfit.id, 'gen-1');
      expect(outfit.name, 'Clean Tailoring');
      expect(outfit.match, 93);
      expect(outfit.completeness, 1.0);
      expect(outfit.itemIds, ['w1', 'w11', 'w4']);
      expect(outfit.pieces,
          ['Oxford Cotton Shirt', 'Beige Chinos', 'Minimalist Sneakers']);
      expect(outfit.explanation, 'A calm palette.');
      expect(outfit.factors!.single.label, 'Color Harmony');
      expect(outfit.factors!.single.value, 90);
      expect(outfit.favorite, false);
    });

    test('accepts the matchScore alias and the imageUrl alias', () {
      final json = outfitJson()
        ..remove('match')
        ..remove('image')
        ..addAll({
          'matchScore': 88,
          'imageUrl': 'http://localhost:3002/storage/outfit.jpg',
        });
      final outfit = outfitFromJson(json);

      expect(outfit.match, 88);
      expect(outfit.image, 'http://localhost:3002/storage/outfit.jpg');
    });

    test('minimal payloads fall back to the documented defaults', () {
      final outfit = outfitFromJson({'id': 'gen-2'});

      expect(outfit.id, 'gen-2');
      expect(outfit.name, 'Untitled look');
      expect(outfit.occasion, 'Casual');
      expect(outfit.match, 85);
      expect(outfit.image, isNotEmpty);
      expect(outfit.pieces, isEmpty);
      expect(outfit.itemIds, isEmpty);
      expect(outfit.completeness, isNull);
      expect(outfit.explanation, isNull);
      expect(outfit.createdAt, isNull);
    });

    test('breakdown rows keep their factor metadata', () {
      final outfit = outfitFromJson({
        'id': 'gen-3',
        'breakdown': [
          {
            'key': 'color_harmony',
            'label': 'Color Harmony',
            'value': 90,
            'weight': 0.2,
            'applied': true,
            'contribution': 18.0,
          },
          {
            'key': 'style_profile',
            'label': 'Style Profile',
            'value': 0,
            'weight': 0,
            'applied': false,
            'contribution': 0,
          },
        ],
      });

      expect(outfit.factors, hasLength(2));
      expect(outfit.factors![0].key, 'color_harmony');
      expect(outfit.factors![0].contribution, 18.0);
      expect(outfit.factors![1].applied, false);
      expect(outfit.breakdown![0].label, 'Color Harmony');
      expect(outfit.breakdown![0].value, 90);
    });

    test('parses saved-outfit metadata', () {
      final outfit = outfitFromJson(outfitJson()
        ..addAll({
          'favorite': true,
          'variant': 'remix',
          'note': 'Swap the sneakers for loafers.',
          'keptFromOriginal': 2,
          'regenerated': true,
          'createdAt': '2026-11-20T10:00:00.000Z',
        }));

      expect(outfit.favorite, true);
      expect(outfit.variant, 'remix');
      expect(outfit.note, 'Swap the sneakers for loafers.');
      expect(outfit.keptFromOriginal, 2);
      expect(outfit.regenerated, true);
      expect(outfit.createdAt, isNotNull);
      expect(outfit.createdAt!.year, 2026);
    });
  });
}
