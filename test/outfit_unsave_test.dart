import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:smartwardrobe/core/api/api_client.dart';
import 'package:smartwardrobe/core/api/smartwardrobe_api.dart';
import 'package:smartwardrobe/data/app_state.dart';
import 'package:smartwardrobe/data/models.dart';
import 'package:smartwardrobe/features/outfits/outfits_screen.dart';

/// Phase 3 — safe Unsave.
///
/// The live backend is replaced through [AppState.apiOverride]. These assert
/// the app-side contract for the relationship model: a successful unsave drops
/// the outfit from the Saved grid without touching anything else, a failed
/// unsave keeps the outfit and reports the real error, and re-saving restores
/// it. The live round-trip (relationship row only, record preserved) is covered
/// by backend/test/saved-outfits.test.js.
class _FakeApi extends SmartWardrobeApi {
  _FakeApi() : super(ApiClient());

  /// What `GET /outfits/saved` would answer — the user's saved outfits only.
  final List<Map<String, dynamic>> serverOutfits = [];

  bool failUnsave = false;
  bool failSave = false;
  int unsaveCalls = 0;
  int saveCalls = 0;

  @override
  Future<List<dynamic>> outfits({bool? favorite}) async {
    return [
      for (final o in serverOutfits)
        if (favorite == null || (favorite == true) == (o['favorite'] == true)) o,
    ];
  }

  @override
  Future<void> unsaveOutfit(String outfitId) async {
    unsaveCalls++;
    if (failUnsave) throw ApiException('Backend offline.', status: 503);
    serverOutfits.removeWhere((o) => o['id'] == outfitId);
  }

  @override
  Future<Map<String, dynamic>> saveOutfit(String outfitId) async {
    saveCalls++;
    if (failSave) throw ApiException('Backend offline.', status: 503);
    // The record is kept independently of the saved list (that is the whole
    // point of the relationship model), so re-saving can always resolve it.
    final existing = serverOutfits.where((o) => o['id'] == outfitId).toList();
    final outfit = existing.isNotEmpty
        ? existing.first
        : <String, dynamic>{'id': outfitId, 'favorite': false};
    if (existing.isEmpty) serverOutfits.insert(0, outfit);
    return <String, dynamic>{'saved': true, 'outfit': outfit};
  }
}

Map<String, dynamic> outfitRow(String id, String name, {bool favorite = false}) =>
    <String, dynamic>{
      'id': id,
      'name': name,
      'occasion': 'Casual',
      'image': 'assets/images/outfit_flatlay_beige.jpg',
      'match': 80,
      'compatibilityScore': 80,
      'pieces': ['White Tee', 'Raw Denim'],
      'itemIds': ['w1', 'w2'],
      'favorite': favorite,
      'createdAt': '2026-01-01T00:00:00.000Z',
    };

void main() {
  final state = AppState.instance;
  late _FakeApi fake;

  setUp(() async {
    fake = _FakeApi();
    state.apiOverride = fake;
    state.savedOutfits = const [];
    state.outfitsLoading = false;
    state.outfitsSettled = false;
    state.outfitsError = null;
    state.lastError = null;
    fake.serverOutfits.add(outfitRow('o1', 'Real Look'));
  });

  tearDown(() {
    state.apiOverride = null;
    state.savedOutfits = const [];
    state.outfitsLoading = false;
    state.outfitsSettled = false;
    state.outfitsError = null;
    state.lastError = null;
  });

  Future<void> pumpScreen(WidgetTester tester) async {
    tester.view.physicalSize = const Size(1080, 3200);
    tester.view.devicePixelRatio = 2.5;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(const MaterialApp(home: OutfitsScreen()));
    await tester.pumpAndSettle();
  }

  /// Let the SnackBar's auto-dismiss timer expire so no timer outlives the test.
  Future<void> settleSnackbar(WidgetTester tester) async {
    await tester.pump(const Duration(seconds: 5));
    await tester.pump();
  }

  group('AppState.unsaveOutfit', () {
    test('removes the outfit only after the server confirms', () async {
      await state.loadOutfits();
      expect(state.savedOutfits.single.id, 'o1');

      final ok = await state.unsaveOutfit(state.savedOutfits.single);

      expect(ok, isTrue);
      expect(fake.unsaveCalls, 1);
      expect(state.savedOutfits, isEmpty,
          reason: 'the confirmed unsave must drop it from the grid source');
      expect(fake.serverOutfits, isEmpty);
    });

    test('a failed unsave keeps the outfit and reports the real error',
        () async {
      await state.loadOutfits();
      fake.failUnsave = true;

      final ok = await state.unsaveOutfit(state.savedOutfits.single);

      expect(ok, isFalse);
      expect(state.savedOutfits.single.id, 'o1',
          reason: 'a failed removal must not update local state');
      expect(state.lastError, contains('Backend offline'));
    });

    test('unsaving an outfit that is not saved is a safe no-op', () async {
      await state.loadOutfits();
      final other = Outfit.fromJson(outfitRow('o9', 'Ghost Look'));

      final ok = await state.unsaveOutfit(other);

      expect(ok, isTrue);
      expect(state.savedOutfits.single.id, 'o1');
    });
  });

  group('AppState.saveOutfit', () {
    test('re-saving restores the outfit to the grid', () async {
      await state.loadOutfits();
      final outfit = state.savedOutfits.single;
      await state.unsaveOutfit(outfit);
      expect(state.savedOutfits, isEmpty);

      final ok = await state.saveOutfit(outfit);

      expect(ok, isTrue);
      expect(fake.saveCalls, 1);
      expect(state.savedOutfits.single.id, 'o1');
    });

    test('a failed save leaves the grid untouched', () async {
      final outfit = Outfit.fromJson(outfitRow('o1', 'Real Look'));
      fake.failSave = true;

      final ok = await state.saveOutfit(outfit);

      expect(ok, isFalse);
      expect(state.savedOutfits, isEmpty);
      expect(state.lastError, contains('Backend offline'));
    });
  });

  group('OutfitsScreen Saved tab', () {
    testWidgets('shows an unsave control on every saved card', (tester) async {
      await pumpScreen(tester);

      expect(find.byKey(const ValueKey('unsave_o1')), findsOneWidget);
    });

    testWidgets('confirming unsave removes the card and reports success',
        (tester) async {
      await pumpScreen(tester);
      expect(find.text('Real Look'), findsOneWidget);

      await tester.tap(find.byKey(const ValueKey('unsave_o1')));
      await tester.pumpAndSettle();
      expect(find.text('Remove saved outfit?'), findsOneWidget);

      await tester.tap(find.text('Remove'));
      await tester.pumpAndSettle();

      expect(find.text('Real Look'), findsNothing);
      expect(find.text('Removed from saved outfits.'), findsOneWidget);
      expect(fake.unsaveCalls, 1);
      expect(tester.takeException(), isNull);
      await settleSnackbar(tester);
    });

    testWidgets('cancelling the dialog keeps the outfit saved', (tester) async {
      await pumpScreen(tester);

      await tester.tap(find.byKey(const ValueKey('unsave_o1')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Cancel'));
      await tester.pumpAndSettle();

      expect(find.text('Real Look'), findsOneWidget);
      expect(fake.unsaveCalls, 0);
      expect(tester.takeException(), isNull);
    });

    testWidgets('a failed unsave keeps the card and surfaces the error',
        (tester) async {
      fake.failUnsave = true;
      await pumpScreen(tester);

      await tester.tap(find.byKey(const ValueKey('unsave_o1')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Remove'));
      await tester.pumpAndSettle();

      expect(find.text('Real Look'), findsOneWidget,
          reason: 'the outfit must stay when the server rejected the removal');
      expect(find.textContaining('Backend offline'), findsOneWidget);
      expect(tester.takeException(), isNull);
      await settleSnackbar(tester);
    });
  });
}
