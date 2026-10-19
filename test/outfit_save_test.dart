import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:smartwardrobe/core/api/api_client.dart';
import 'package:smartwardrobe/core/api/smartwardrobe_api.dart';
import 'package:smartwardrobe/data/app_state.dart';
import 'package:smartwardrobe/data/models.dart';
import 'package:smartwardrobe/features/outfits/perfect_match_screen.dart';

/// Phase 1 — Saved Outfits save flow.
///
/// The live backend is replaced with [_FakeApi] through
/// [AppState.apiOverride], so these run offline and assert the app-side
/// contract: a successful save refreshes [AppState.savedOutfits], a failed save
/// never does, and repeated saves of one look do not mint duplicates. The live
/// round-trip itself is covered by backend/test and the contract suite.
class _FakeApi extends SmartWardrobeApi {
  _FakeApi() : super(ApiClient());

  /// What `GET /outfits` would answer, newest first.
  final List<Map<String, dynamic>> serverOutfits = [];

  /// When true, `POST /outfits` fails the way an offline backend does.
  bool failCreate = false;

  int createCalls = 0;
  int outfitsCalls = 0;

  /// The exact body the last `POST /outfits` would have sent, so the save flow
  /// can be asserted to carry the shown score, breakdown, explanation and the
  /// source recommendation id.
  Map<String, dynamic>? lastCreateBody;

  /// What `GET /outfits/:id/rating` answers when a screen loads a real id.
  int? ratingAnswer;

  @override
  Future<int?> outfitRating(String outfitId) async => ratingAnswer;

  @override
  Future<List<dynamic>> outfits({bool? favorite}) async {
    outfitsCalls++;
    return [
      for (final o in serverOutfits)
        if (favorite == null || (favorite == true) == (o['favorite'] == true)) o,
    ];
  }

  @override
  Future<Map<String, dynamic>> createOutfit(
    String name,
    List<String> itemIds, {
    String occasion = 'Casual',
    int? compatibilityScore,
    List<Map<String, dynamic>>? breakdown,
    String? explanation,
    String? sourceOutfitId,
  }) async {
    createCalls++;
    if (failCreate) throw ApiException('Backend offline.', status: 503);
    lastCreateBody = <String, dynamic>{
      'name': name,
      'itemIds': itemIds,
      'occasion': occasion,
      'compatibilityScore': ?compatibilityScore,
      if (breakdown != null && breakdown.isNotEmpty) 'breakdown': breakdown,
      if (explanation != null && explanation.isNotEmpty) 'explanation': explanation,
      if (sourceOutfitId != null && sourceOutfitId.isNotEmpty)
        'sourceOutfitId': sourceOutfitId,
    };
    final outfit = <String, dynamic>{
      'id': 'o_${serverOutfits.length + 1}',
      'name': name,
      'occasion': occasion,
      'image': 'assets/images/outfit_flatlay_beige.jpg',
      'match': compatibilityScore ?? 80,
      'compatibilityScore': compatibilityScore ?? 80,
      if (breakdown != null && breakdown.isNotEmpty) 'breakdown': breakdown,
      if (explanation != null && explanation.isNotEmpty) 'explanation': explanation,
      'pieces': [for (final id in itemIds) 'Item $id'],
      'itemIds': itemIds,
      'favorite': false,
      'createdAt': '2026-01-01T00:00:00.000Z',
    };
    serverOutfits.insert(0, outfit);
    return <String, dynamic>{'outfit': outfit};
  }
}

void main() {
  final state = AppState.instance;
  late _FakeApi fake;

  /// A `GET /outfits` row the way the backend serialises it.
  Map<String, dynamic> outfitRow(
    String id,
    String name,
    String occasion,
    List<String> itemIds,
  ) =>
      <String, dynamic>{
        'id': id,
        'name': name,
        'occasion': occasion,
        'image': 'assets/images/outfit_flatlay_beige.jpg',
        'match': 80,
        'compatibilityScore': 80,
        'pieces': [for (final id in itemIds) 'Item $id'],
        'itemIds': itemIds,
        'favorite': false,
        'createdAt': '2026-01-01T00:00:00.000Z',
      };

  setUp(() async {
    fake = _FakeApi();
    state.apiOverride = fake;
    // Seed the fake backend with two existing outfits and load them, so the
    // refresh inside createOutfit has real data to preserve.
    fake.serverOutfits.addAll([
      outfitRow('o1', 'Saved One', 'Casual', const ['w1', 'w2']),
      outfitRow('o2', 'Saved Two', 'Formal', const ['w3']),
    ]);
    state.lastError = null;
    await state.loadOutfits();
  });

  tearDown(() {
    state.apiOverride = null;
    state.savedOutfits = const [];
    state.outfitsLoading = false;
    state.outfitsSettled = false;
    state.outfitsError = null;
    state.lastError = null;
  });

  group('AppState.createOutfit', () {
    test('successful save persists and refreshes savedOutfits', () async {
      final result = await state.createOutfit(
        name: 'Test Look',
        itemIds: const ['w1', 'w2'],
        occasion: 'Casual',
      );

      expect(result, SaveOutfitResult.saved);
      expect(fake.createCalls, 1);
      expect(
        state.savedOutfits.any((o) => o.name == 'Test Look'),
        isTrue,
        reason: 'the new outfit must be visible in the Saved grid',
      );
      expect(state.savedOutfits.first.itemIds, const ['w1', 'w2']);
    });

    test('failed save reports failure and leaves savedOutfits untouched',
        () async {
      fake.failCreate = true;
      final before = [for (final o in state.savedOutfits) o.id];

      final result = await state.createOutfit(
        name: 'Doomed Look',
        itemIds: const ['w1', 'w2'],
        occasion: 'Casual',
      );

      expect(result, SaveOutfitResult.failed);
      expect([for (final o in state.savedOutfits) o.id], before);
      expect(state.savedOutfits.any((o) => o.name == 'Doomed Look'), isFalse);
      expect(state.lastError, isNotNull);
    });

    test('repeated save of the same outfit does not create a duplicate',
        () async {
      final first = await state.createOutfit(
        name: 'Twin',
        itemIds: const ['w1', 'w2'],
        occasion: 'Casual',
      );
      expect(first, SaveOutfitResult.saved);
      expect(fake.serverOutfits.where((o) => o['name'] == 'Twin').length, 1);

      final second = await state.createOutfit(
        name: 'Twin',
        itemIds: const ['w1', 'w2'],
        occasion: 'Casual',
      );

      expect(second, SaveOutfitResult.duplicate);
      expect(fake.serverOutfits.where((o) => o['name'] == 'Twin').length, 1);
      expect(fake.createCalls, 1, reason: 'the duplicate must skip the POST');
    });

    test('genuinely different outfits are both saved', () async {
      await state.createOutfit(
        name: 'Look A',
        itemIds: const ['w1'],
        occasion: 'Casual',
      );
      final second = await state.createOutfit(
        name: 'Look B',
        itemIds: const ['w1'],
        occasion: 'Casual',
      );

      expect(second, SaveOutfitResult.saved);
      final added =
          fake.serverOutfits.where((o) => o['name'] != 'Saved One' && o['name'] != 'Saved Two');
      expect(added.length, 2);
    });
  });

  group('AppState.sameOutfit identity rule', () {
    Outfit make(String name, String occasion, List<String> ids) => Outfit(
          id: '',
          name: name,
          image: '',
          occasion: occasion,
          match: 0,
          pieces: const <String>[],
          itemIds: ids,
        );

    test('occasion is case-insensitive but the item order is significant', () {
      expect(
        AppState.sameOutfit(
          make('A', 'Casual', ['w1', 'w2']),
          make('A', 'casual', ['w1', 'w2']),
        ),
        isTrue,
      );
      expect(
        AppState.sameOutfit(
          make('A', 'Casual', ['w1', 'w2']),
          make('A', 'Casual', ['w2', 'w1']),
        ),
        isFalse,
        reason: 'a reordered item list is a different save',
      );
    });

    test('a different name or occasion is never collapsed', () {
      expect(
        AppState.sameOutfit(
          make('A', 'Casual', ['w1']),
          make('B', 'Casual', ['w1']),
        ),
        isFalse,
      );
      expect(
        AppState.sameOutfit(
          make('A', 'Casual', ['w1']),
          make('A', 'Formal', ['w1']),
        ),
        isFalse,
      );
    });
  });

  group('PerfectMatchScreen Save Outfit', () {
    // id is empty so the screen does not fetch a rating on open; a breakdown is
    // supplied so `_resolve` never calls `/ai/calculate-compatibility`.
    Outfit saveable() => Outfit(
          id: '',
          name: 'Save Test Look',
          image: 'assets/images/outfit_flatlay_beige.jpg',
          occasion: 'Casual',
          match: 85,
          pieces: const ['White Tee', 'Raw Denim'],
          itemIds: const ['w1', 'w2'],
          breakdown: const [(label: 'Color Harmony', value: 90)],
        );

    Future<void> pumpScreen(WidgetTester tester, Outfit outfit) async {
      tester.view.physicalSize = const Size(1080, 3200);
      tester.view.devicePixelRatio = 2.5;
      addTearDown(tester.view.reset);
      await tester.pumpWidget(
        MaterialApp(home: PerfectMatchScreen(outfit: outfit)),
      );
      await tester.pump();
    }

    /// Let the SnackBar's auto-dismiss timer expire so no timer outlives the
    /// test.
    Future<void> settleSnackbar(WidgetTester tester) async {
      await tester.pump(const Duration(seconds: 5));
      await tester.pump();
    }

    testWidgets('a successful save shows success and updates savedOutfits',
        (tester) async {
      await pumpScreen(tester, saveable());

      await tester.ensureVisible(find.text('Save Outfit'));
      await tester.tap(find.text('Save Outfit'));
      await tester.pumpAndSettle();

      expect(find.text('Outfit saved.'), findsOneWidget);
      expect(
        state.savedOutfits.any((o) => o.name == 'Save Test Look'),
        isTrue,
        reason: 'the grid source must refresh without a manual reload',
      );
      expect(tester.takeException(), isNull);
      await settleSnackbar(tester);
    });

    testWidgets('a failed save reports the failure, never success',
        (tester) async {
      fake.failCreate = true;
      await pumpScreen(tester, saveable());
      final before = [for (final o in state.savedOutfits) o.id];

      await tester.ensureVisible(find.text('Save Outfit'));
      await tester.tap(find.text('Save Outfit'));
      await tester.pumpAndSettle();

      expect(find.text('Outfit saved.'), findsNothing);
      expect(find.textContaining('Backend offline'), findsOneWidget);
      expect([for (final o in state.savedOutfits) o.id], before);
      expect(tester.takeException(), isNull);
      await settleSnackbar(tester);
    });

    testWidgets('saving the same look twice does not create a duplicate',
        (tester) async {
      await pumpScreen(tester, saveable());

      await tester.ensureVisible(find.text('Save Outfit'));
      await tester.tap(find.text('Save Outfit'));
      await tester.pumpAndSettle();
      await settleSnackbar(tester);

      await tester.tap(find.text('Save Outfit'));
      await tester.pumpAndSettle();

      expect(find.text('Outfit already saved.'), findsOneWidget);
      expect(
        fake.serverOutfits.where((o) => o['name'] == 'Save Test Look').length,
        1,
      );
      expect(tester.takeException(), isNull);
      await settleSnackbar(tester);
    });

    testWidgets('a look with no items is refused, not reported as saved',
        (tester) async {
      await pumpScreen(
        tester,
        const Outfit(
          id: '',
          name: 'No Items',
          image: 'assets/images/outfit_flatlay_beige.jpg',
          occasion: 'Casual',
          match: 85,
          pieces: <String>[],
        ),
      );

      await tester.ensureVisible(find.text('Save Outfit'));
      await tester.tap(find.text('Save Outfit'));
      await tester.pumpAndSettle();

      expect(find.text('Outfit saved.'), findsNothing);
      expect(find.text('This look has no items to save.'), findsOneWidget);
      expect(fake.createCalls, 0);
      expect(tester.takeException(), isNull);
      await settleSnackbar(tester);
    });
  });

  group('Saved Outfits Fix Phase A — score / rating / explanation forwarding',
      () {
    /// A recommendation with a real id (so it can hand the backend a
    /// `sourceOutfitId`), a shown compatibility score, a breakdown and an
    /// explanation.
    Outfit recommendation() => Outfit(
          id: 'gen-recommend-1',
          name: 'Recommended Look',
          image: 'assets/images/outfit_flatlay_beige.jpg',
          occasion: 'Casual',
          match: 85,
          compatibilityScore: 85,
          pieces: const ['White Tee', 'Raw Denim'],
          itemIds: const ['w1', 'w2'],
          breakdown: const [(label: 'Color Harmony', value: 90)],
          explanation: 'The palette is calm and the occasion fit is strong.',
        );

    Future<void> pumpScreen(WidgetTester tester, Outfit outfit) async {
      tester.view.physicalSize = const Size(1080, 3200);
      tester.view.devicePixelRatio = 2.5;
      addTearDown(tester.view.reset);
      await tester.pumpWidget(
        MaterialApp(home: PerfectMatchScreen(outfit: outfit)),
      );
      await tester.pump();
    }

    Future<void> settleSnackbar(WidgetTester tester) async {
      await tester.pump(const Duration(seconds: 5));
      await tester.pump();
    }

    testWidgets(
        'saving a recommendation forwards its score, breakdown, explanation and source id',
        (tester) async {
      await pumpScreen(tester, recommendation());

      await tester.ensureVisible(find.text('Save Outfit'));
      await tester.tap(find.text('Save Outfit'));
      await tester.pumpAndSettle();

      expect(find.text('Outfit saved.'), findsOneWidget);
      final body = fake.lastCreateBody;
      expect(body, isNotNull, reason: 'the POST must have been sent');
      // The shown compatibility score, not a recomputed one.
      expect(body!['compatibilityScore'], 85);
      expect(body['sourceOutfitId'], 'gen-recommend-1');
      expect(body['explanation'], 'The palette is calm and the occasion fit is strong.');
      // The breakdown carries the shown factors (label + value at minimum).
      final breakdown = (body['breakdown'] as List?) ?? const [];
      expect(breakdown, isNotEmpty);
      expect((breakdown.first as Map)['label'], 'Color Harmony');
      expect((breakdown.first as Map)['value'], 90);
      await settleSnackbar(tester);
    });

    testWidgets('the screen shows the persisted explanation, not the fallback',
        (tester) async {
      await pumpScreen(tester, recommendation());

      expect(find.text('The palette is calm and the occasion fit is strong.'),
          findsOneWidget);
      // The generic fallback copy must not be present when an explanation exists.
      expect(find.textContaining('because the neutral colors'), findsNothing);
      expect(tester.takeException(), isNull);
    });

    testWidgets('an outfit with no explanation still shows the fallback copy',
        (tester) async {
      await pumpScreen(
        tester,
        const Outfit(
          id: 'gen-noexp',
          name: 'Unexplained',
          image: 'assets/images/outfit_flatlay_beige.jpg',
          occasion: 'Casual',
          match: 85,
          pieces: ['White Tee'],
          itemIds: ['w1'],
        ),
      );

      expect(find.textContaining('because the neutral colors'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });
  });
}
