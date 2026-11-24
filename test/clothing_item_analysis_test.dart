import 'package:flutter_test/flutter_test.dart';

import 'package:smartwardrobe/data/dto/mappers.dart';
import 'package:smartwardrobe/data/models.dart';

void main() {
  group('ClothingItem AI analysis parsing', () {
    test('parses a full vision analysis payload from the backend', () {
      final item = clothingItemFromJson({
        'id': 'w_99',
        'name': 'Navy Wool Blazer',
        'image': 'http://localhost:3002/storage/blazer.jpg',
        'category': 'Outerwear',
        'color': 'Navy',
        'style': 'Formal',
        'material': 'Wool',
        'season': 'Autumn / Winter',
        'formality': 'Formal',
        'pattern': 'Plain',
        'timesWorn': 0,
        'analysisSource': 'clothing-vision+gemini',
        'analysisConfidence': 0.87,
        'analysisRejected': false,
        'analyzedAt': '2026-11-16T13:45:00.000Z',
        'analysis': {
          'success': true,
          'category': 'Outerwear',
          'color': 'Navy',
          'uncertainAttributes': ['material'],
          'colorDetail': {'color': 'Navy', 'confidence': 0.92, 'method': 'lab-median'},
        },
      });

      expect(item.id, 'w_99');
      expect(item.pattern, 'Plain');
      expect(item.analysisSource, 'clothing-vision+gemini');
      expect(item.analysisConfidence, 0.87);
      expect(item.analysisRejected, false);
      expect(item.analyzedAt, isNotNull);
      expect(item.analyzedAt!.year, 2026);
      expect(item.analysisRaw, isNotNull);
      expect(item.analysisRaw!['uncertainAttributes'], ['material']);
      expect(item.analysisStatus, 'analyzed');
      expect(item.analysisStatusLabel, 'Analyzed by AI vision.');
      expect(item.colorWithConfidence, 'Navy (87%)');
      expect(item.uncertainAttributesList, ['material']);
    });

    test('reads the same provenance nested under the legacy column', () {
      final item = clothingItemFromJson({
        'id': 'w_99b',
        'name': 'Navy Wool Blazer',
        'imageUrl': 'http://localhost:3002/storage/blazer.jpg',
        'category': 'Outerwear',
        'color': 'Navy',
        'style': 'Formal',
        'material': 'Wool',
        'season': 'Autumn / Winter',
        'formality': 'Formal',
        'legacy': {
          'analysisSource': 'clothing-vision+gemini',
          'analysisConfidence': 0.87,
          'analysisRejected': false,
          'analyzedAt': '2026-11-16T13:45:00.000Z',
          'analysis': {
            'success': true,
            'uncertainAttributes': ['material'],
          },
        },
      });

      expect(item.image, 'http://localhost:3002/storage/blazer.jpg');
      expect(item.analysisSource, 'clothing-vision+gemini');
      expect(item.analysisConfidence, 0.87);
      expect(item.analysisStatus, 'analyzed');
      expect(item.uncertainAttributesList, ['material']);
    });

    test('marks a non-clothing rejection as rejected', () {
      final item = clothingItemFromJson({
        'id': 'w_100',
        'name': 'Bottle',
        'image': 'http://localhost:3002/storage/bottle.jpg',
        'category': 'Accessories',
        'color': 'Clear',
        'style': 'Casual',
        'material': 'Plastic',
        'season': 'All Season',
        'formality': 'Casual',
        'analysisSource': 'non_clothing',
        'analysisRejected': true,
        'analysisConfidence': null,
        'analysis': {
          'success': false,
          'error_type': 'non_clothing',
          'error': 'This photo does not contain clothing.',
        },
      });

      expect(item.analysisSource, 'non_clothing');
      expect(item.analysisRejected, true);
      expect(item.analysisConfidence, isNull);
      expect(item.analysisStatus, 'rejected');
      expect(
        item.analysisStatusLabel,
        'Rejected by the AI gate — not detected as clothing.',
      );
    });

    test('derives uncertain status from low confidence', () {
      final item = clothingItemFromJson({
        'id': 'w_101',
        'name': 'Guess',
        'image': 'http://localhost:3002/storage/guess.jpg',
        'category': 'Tops',
        'color': 'White',
        'style': 'Casual',
        'material': 'Cotton',
        'season': 'All Season',
        'formality': 'Casual',
        'analysisSource': 'clothing-vision',
        'analysisConfidence': 0.4,
        'analysisRejected': false,
        'analysis': {
          'success': true,
          'uncertainAttributes': ['style', 'season'],
        },
      });

      expect(item.analysisStatus, 'uncertain');
      expect(item.analysisStatusLabel,
          'Analyzed with low confidence — verify the tags below.');
      expect(item.uncertainAttributesList, ['style', 'season']);
    });

    test('reports heuristic and filename sources without a status', () {
      final heuristic = clothingItemFromJson({
        'id': 'w_102',
        'name': 'Item',
        'image': 'assets/images/item_tee_white.jpg',
        'category': 'Tops',
        'color': 'White',
        'style': 'Casual',
        'material': 'Cotton',
        'season': 'All Season',
        'formality': 'Casual',
        'analysisSource': 'heuristic',
      });
      expect(heuristic.analysisStatus, 'heuristic');
      expect(heuristic.analysisStatusLabel,
          'Analyzed offline — tags are best-guess defaults.');

      final filename = clothingItemFromJson({
        'id': 'w_103',
        'name': 'Item',
        'image': 'assets/images/item_tee_white.jpg',
        'category': 'Tops',
        'color': 'White',
        'style': 'Casual',
        'material': 'Cotton',
        'season': 'All Season',
        'formality': 'Casual',
        'analysisSource': 'filename',
        'analysisConfidence': 0.3,
      });
      expect(filename.analysisStatus, 'filename');
      expect(filename.analysisStatusLabel,
          'Unverified — tags guessed from the file name.');
      expect(filename.colorWithConfidence, 'White (30%)');
    });

    test('returns null status when there is no analysis record', () {
      final item = clothingItemFromJson({
        'id': 'w_104',
        'name': 'Plain Tee',
        'image': 'assets/images/item_tee_white.jpg',
        'category': 'Tops',
        'color': 'White',
        'style': 'Casual',
        'material': 'Cotton',
        'season': 'All Season',
        'formality': 'Casual',
      });

      expect(item.analysisSource, isNull);
      expect(item.analysisStatus, isNull);
      expect(item.analysisStatusLabel, isNull);
      expect(item.uncertainAttributesList, isEmpty);
      expect(item.colorWithConfidence, 'White');
    });

    test('defaults pattern to Plain and serializes the wardrobe shape', () {
      final item = clothingItemFromJson({
        'id': 'w_105',
        'name': 'Striped Tee',
        'image': 'assets/images/item_tee_white.jpg',
        'category': 'Tops',
        'color': 'White',
        'style': 'Casual',
        'material': 'Cotton',
        'season': 'All Season',
        'formality': 'Casual',
        'pattern': 'Striped',
      });

      expect(item.pattern, 'Striped');
      final json = clothingItemToJson(item);
      expect(json['id'], 'w_105');
      expect(json['name'], 'Striped Tee');
      expect(json['category'], 'Tops');

      const plain = ClothingItem(
        id: 'w_106',
        name: 'Tee',
        image: 'assets/images/item_tee_white.jpg',
        category: 'Tops',
        color: 'White',
        style: 'Casual',
        material: 'Cotton',
        season: 'All Season',
        formality: 'Casual',
      );
      expect(plain.pattern, 'Plain');
    });
  });
}
