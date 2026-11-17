import 'package:flutter_test/flutter_test.dart';
import 'package:smartwardrobe/data/models.dart';

Map<String, dynamic> outfitJson({
  Object? completeness,
  Object? completenessDetail,
  Object? provenance,
  Object? grounding,
}) =>
    {
      'id': 'gen-1',
      'name': 'Clean Tailoring',
      'image': 'assets/images/outfit.jpg',
      'occasion': 'casual',
      'match': 93,
      'compatibilityScore': 91,
      'rankingScore': 88,
      'breakdown': [
        {'label': 'Color Harmony', 'value': 90},
      ],
      'itemIds': ['w1', 'w11', 'w4'],
      'pieces': ['Oxford Cotton Shirt', 'Beige Chinos', 'Minimalist Sneakers'],
      'explanation': 'A calm palette.',
      'completeness': completeness,
      'completenessDetail': completenessDetail,
      'provenance': provenance,
      'grounding': grounding,
    };

void main() {
  group('Outfit.fromJson contract fields', () {
    test('parses the canonical completion payload', () {
      final outfit = Outfit.fromJson(outfitJson(
        completeness: 1.0,
        completenessDetail: {'ratio': 1, 'filled': 3, 'required': 3},
        provenance: 'llm_ids',
        grounding: {
          'recoveredItemIds': ['w1', 'w11', 'w4'],
          'usedFallback': false,
          'allOwned': true,
        },
      ));

      expect(outfit.match, 93);
      expect(outfit.compatibilityScore, 91);
      expect(outfit.rankingScore, 88);
      expect(outfit.completeness, 1.0);
      expect(outfit.completenessDetail, {'ratio': 1, 'filled': 3, 'required': 3});
      expect(outfit.provenance, 'llm_ids');
      expect(outfit.grounding?['usedFallback'], false);
      expect(outfit.itemIds, ['w1', 'w11', 'w4']);
    });

    test('parses the legacy completeness object without losing the number', () {
      final outfit = Outfit.fromJson(outfitJson(
        completeness: {'ratio': 0.67, 'filled': 2, 'required': 3},
        provenance: 'remix',
      ));

      expect(outfit.completeness, closeTo(0.67, 0.0001));
      expect(outfit.completenessDetail, {'ratio': 0.67, 'filled': 2, 'required': 3});
      expect(outfit.provenance, 'remix');
      expect(outfit.grounding, isNull);
    });

    test('legacy payloads without the new fields still parse', () {
      final json = outfitJson()..remove('completeness');
      json
        ..remove('completenessDetail')
        ..remove('provenance')
        ..remove('grounding');
      final outfit = Outfit.fromJson(json);

      expect(outfit.completeness, isNull);
      expect(outfit.completenessDetail, isNull);
      expect(outfit.provenance, isNull);
      expect(outfit.grounding, isNull);
      expect(outfit.match, 93);
      expect(outfit.factors!.single.label, 'Color Harmony');
    });

    test('malformed optional fields degrade to null instead of throwing', () {
      final outfit = Outfit.fromJson(outfitJson(
        completeness: 'not-a-number',
        completenessDetail: 'not-a-map',
        provenance: 42,
        grounding: ['not', 'a', 'map'],
      ));

      expect(outfit.completeness, isNull);
      expect(outfit.completenessDetail, isNull);
      expect(outfit.provenance, isNull);
      expect(outfit.grounding, isNull);
    });
  });
}
