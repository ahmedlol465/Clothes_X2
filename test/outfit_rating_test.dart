import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:smartwardrobe/core/icons/sw_icon.dart';
import 'package:smartwardrobe/data/app_state.dart';
import 'package:smartwardrobe/data/models.dart';
import 'package:smartwardrobe/features/outfits/perfect_match_screen.dart';

/// Phase 3 — the 1–5 star outfit rating control on [PerfectMatchScreen].
///
/// Everything runs offline: flutter_test's mock HTTP answers 400, so the
/// `GET /outfits/:id/rating` load and the `POST` save both fail fast. That is
/// exactly the failure path under test (the control must degrade to "no
/// selection" and report a failed save, never crash); the live round-trip is
/// covered by the backend suite in backend/test/outfit-rating.test.js.
void main() {
  final state = AppState.instance;
  const outfit = Outfit(
    id: 'o_rating_test',
    name: 'Rating Test Look',
    image: 'assets/images/outfit_flatlay_beige.jpg',
    occasion: 'Casual',
    match: 88,
    pieces: <String>[],
    itemIds: <String>[],
  );

  setUp(() => state.outfitRatings.clear());
  tearDown(() => state.outfitRatings.clear());

  /// The mock client's per-request timeout timer only expires after
  /// `ApiConfig.timeout` (8 s); burn the clock so no timer outlives the test.
  Future<void> drainTimeouts(WidgetTester tester) async {
    await tester.pump(const Duration(seconds: 9));
    await tester.pump();
  }

  Future<void> pumpScreen(WidgetTester tester) async {
    tester.view.physicalSize = const Size(1080, 3200);
    tester.view.devicePixelRatio = 2.5;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(
      const MaterialApp(home: PerfectMatchScreen(outfit: outfit)),
    );
    await tester.pump();
  }

  int filledStars(WidgetTester tester) => tester
      .widgetList<SwIconView>(find.byType(SwIconView))
      .where((w) => w.icon == SwIcon.starFill)
      .length;

  int emptyStars(WidgetTester tester) => tester
      .widgetList<SwIconView>(find.byType(SwIconView))
      .where((w) => w.icon == SwIcon.star)
      .length;

  testWidgets('unrated outfit shows the prompt with five empty stars',
      (tester) async {
    await pumpScreen(tester);
    await tester.pumpAndSettle();

    expect(find.text('Rate this look'), findsOneWidget);
    expect(find.text('How well does this outfit match your style?'),
        findsOneWidget);
    expect(emptyStars(tester), 5);
    expect(filledStars(tester), 0);
    expect(tester.takeException(), isNull);
    await drainTimeouts(tester);
  });

  testWidgets('a saved rating is shown on open', (tester) async {
    state.outfitRatings[outfit.id] = 4;

    await pumpScreen(tester);
    await tester.pumpAndSettle();

    expect(find.text('Your rating: 4 out of 5.'), findsOneWidget);
    expect(filledStars(tester), 4);
    expect(emptyStars(tester), 1);
    expect(tester.takeException(), isNull);
    await drainTimeouts(tester);
  });

  testWidgets('tapping a star reports the offline save failure without setting a rating',
      (tester) async {
    await pumpScreen(tester);
    await tester.pumpAndSettle();

    await tester.ensureVisible(find.bySemanticsLabel('Rate 5 out of 5'));
    await tester.tap(find.bySemanticsLabel('Rate 5 out of 5'));
    await tester.pumpAndSettle();

    expect(find.textContaining('Could not save rating'), findsOneWidget);
    expect(state.ratingFor(outfit.id), isNull,
        reason: 'a failed save must not update local state');
    expect(tester.takeException(), isNull);
    await drainTimeouts(tester);
  });
}
