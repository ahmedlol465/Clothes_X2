import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:smartwardrobe/core/api/api_client.dart';
import 'package:smartwardrobe/core/api/smartwardrobe_api.dart';
import 'package:smartwardrobe/data/app_state.dart';
import 'package:smartwardrobe/data/models.dart';
import 'package:smartwardrobe/features/outfits/outfits_screen.dart';
import 'package:smartwardrobe/features/outfits/perfect_match_screen.dart';

/// Phase 2 — Saved Outfits loading and display reliability.
///
/// The live backend is replaced through [AppState.apiOverride]. These assert
/// that the app-side states are honest: a real backend answer replaces the
/// list (even when empty), a failure surfaces the real error and keeps the
/// last list, the Saved grid reflects loading/empty/error/success, and a saved
/// outfit never renders bundled [MockData] pieces in place of its own.
class _FakeApi extends SmartWardrobeApi {
  _FakeApi() : super(ApiClient());

  final List<Map<String, dynamic>> serverOutfits = [];
  bool fail = false;

  /// When set, `GET /outfits` pends on this until the test completes it, so the
  /// in-flight loading state can be observed.
  Completer<void>? gate;

  @override
  Future<List<dynamic>> outfits({bool? favorite}) async {
    if (gate != null) await gate!.future;
    if (fail) throw ApiException('Backend offline.', status: 503);
    return [
      for (final o in serverOutfits)
        if (favorite == null || (favorite == true) == (o['favorite'] == true)) o,
    ];
  }
}

Map<String, dynamic> outfitRow(
  String id,
  String name, {
  List<String> itemIds = const ['w1', 'w2'],
  bool favorite = false,
}) =>
    <String, dynamic>{
      'id': id,
      'name': name,
      'occasion': 'Casual',
      'image': 'assets/images/outfit_flatlay_beige.jpg',
      'match': 80,
      'compatibilityScore': 80,
      'pieces': [for (final id in itemIds) 'Piece $id'],
      'itemIds': itemIds,
      'favorite': favorite,
      'createdAt': '2026-01-01T00:00:00.000Z',
    };

ClothingItem item(String id, String image) => ClothingItem(
      id: id,
      name: 'Item $id',
      image: image,
      category: 'Tops',
      color: 'White',
      style: 'Casual',
      material: 'Cotton',
      season: 'All Season',
      formality: 'Casual',
    );

void main() {
  final state = AppState.instance;
  late _FakeApi fake;

  setUp(() {
    fake = _FakeApi();
    state.apiOverride = fake;
    state.wardrobe = [item('w1', 'assets/images/item_tee_white.jpg')];
    state.savedOutfits = const [];
    state.outfitsLoading = false;
    state.outfitsSettled = false;
    state.outfitsError = null;
    state.lastError = null;
  });

  tearDown(() {
    state.apiOverride = null;
    state.wardrobe = const [];
    state.savedOutfits = const [];
    state.outfitsLoading = false;
    state.outfitsSettled = false;
    state.outfitsError = null;
    state.lastError = null;
  });

  group('AppState.loadOutfits', () {
    test('replaces the list with the backend reply and settles', () async {
      fake.serverOutfits.add(outfitRow('o1', 'Real Look'));

      final ok = await state.loadOutfits();

      expect(ok, isTrue);
      expect(state.savedOutfits.single.name, 'Real Look');
      expect(state.outfitsSettled, isTrue);
      expect(state.outfitsLoading, isFalse);
      expect(state.outfitsError, isNull);
    });

    test('an empty reply clears a stale list (no demo leftovers)', () async {
      // Pretend a previous session left outfits cached.
      state.savedOutfits = [
        Outfit.fromJson(outfitRow('stale', 'Stale Look')),
      ];

      final ok = await state.loadOutfits();

      expect(ok, isTrue);
      expect(state.savedOutfits, isEmpty,
          reason: 'the backend has nothing, so nothing may be shown');
      expect(state.outfitsSettled, isTrue);
    });

    test('a failure reports false, keeps the list, and sets the error',
        () async {
      state.savedOutfits = [
        Outfit.fromJson(outfitRow('keep', 'Kept Look')),
      ];
      fake.fail = true;

      final ok = await state.loadOutfits();

      expect(ok, isFalse);
      expect(state.savedOutfits.single.name, 'Kept Look');
      expect(state.outfitsError, contains('Backend offline'));
      expect(state.outfitsSettled, isTrue);
      expect(state.outfitsLoading, isFalse);
    });
  });

  group('OutfitsScreen Saved tab', () {
    Future<void> pump(WidgetTester tester) async {
      tester.view.physicalSize = const Size(1080, 3200);
      tester.view.devicePixelRatio = 2.5;
      addTearDown(tester.view.reset);
      await tester.pumpWidget(const MaterialApp(home: OutfitsScreen()));
    }

    testWidgets('shows a loading state before the first reply', (tester) async {
      fake.gate = Completer<void>();

      await pump(tester);
      await tester.pump();

      expect(find.byKey(const ValueKey('saved_outfits_loading')), findsOneWidget);
      expect(find.byKey(const ValueKey('saved_outfits_empty')), findsNothing);

      fake.gate!.complete();
      await tester.pumpAndSettle();
    });

    testWidgets('shows an honest empty state with a create action',
        (tester) async {
      await pump(tester);
      await tester.pumpAndSettle();

      expect(find.byKey(const ValueKey('saved_outfits_empty')), findsOneWidget);
      expect(find.text('Create an outfit'), findsOneWidget);
      expect(find.byKey(const ValueKey('saved_outfits_grid')), findsNothing);
    });

    testWidgets('shows the real error and a Retry on failure', (tester) async {
      fake.fail = true;

      await pump(tester);
      await tester.pumpAndSettle();

      expect(find.byKey(const ValueKey('saved_outfits_error')), findsOneWidget);
      expect(find.textContaining('Backend offline'), findsOneWidget);
      expect(find.text('Retry'), findsOneWidget);
    });

    testWidgets('shows the grid once outfits arrive', (tester) async {
      fake.serverOutfits.add(outfitRow('o1', 'Real Look'));

      await pump(tester);
      await tester.pumpAndSettle();

      expect(find.byKey(const ValueKey('saved_outfits_grid')), findsOneWidget);
      expect(find.text('Real Look'), findsOneWidget);
      expect(find.byKey(const ValueKey('saved_outfits_empty')), findsNothing);
    });
  });

  group('PerfectMatchScreen pieces', () {
    Future<void> pump(WidgetTester tester, Outfit outfit) async {
      tester.view.physicalSize = const Size(1080, 3200);
      tester.view.devicePixelRatio = 2.5;
      addTearDown(tester.view.reset);
      await tester.pumpWidget(
        MaterialApp(home: PerfectMatchScreen(outfit: outfit)),
      );
      await tester.pump();
    }

    // Empty id so no rating is fetched; a breakdown is supplied so `_resolve`
    // never calls `/ai/calculate-compatibility`.
    Outfit look() => Outfit(
          id: '',
          name: 'Real Look',
          image: 'assets/images/outfit_flatlay_beige.jpg',
          occasion: 'Casual',
          match: 85,
          pieces: const ['White Tee', 'Raw Denim'],
          itemIds: const ['w1', 'w2'],
          breakdown: const [(label: 'Color Harmony', value: 90)],
        );

    testWidgets('resolves its own pieces from the wardrobe, never mock',
        (tester) async {
      state.wardrobe = [
        item('w1', 'assets/images/item_tee_white.jpg'),
        item('w2', 'assets/images/item_denim_raw.jpg'),
      ];

      await pump(tester, look());

      expect(find.byKey(const ValueKey('perfect_match_piece_grid')),
          findsOneWidget);
      expect(find.byKey(const ValueKey('perfect_match_missing_pieces')),
          findsNothing);
    });

    testWidgets('shows a truthful missing state, not mock pieces',
        (tester) async {
      // Wardrobe does not contain this outfit's items.
      state.wardrobe = [item('other', 'assets/images/item_tee_white.jpg')];

      await pump(tester, look());

      expect(find.byKey(const ValueKey('perfect_match_missing_pieces')),
          findsOneWidget);
      expect(find.byKey(const ValueKey('perfect_match_piece_grid')),
          findsNothing);
      expect(find.textContaining('White Tee'), findsOneWidget);
    });
  });
}
