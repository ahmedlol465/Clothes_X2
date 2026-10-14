import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:smartwardrobe/data/app_state.dart';
import 'package:smartwardrobe/data/mock_data.dart';
import 'package:smartwardrobe/data/models.dart';
import 'package:smartwardrobe/features/home/home_screen.dart';
import 'package:smartwardrobe/features/outfits/outfits_screen.dart';
import 'package:smartwardrobe/features/outfits/perfect_match_screen.dart';

/// Section 5 — Home ⇄ `GET /outfits/recommended`.
///
/// Home must show the ranked looks the backend engine produced, in the four
/// states it owes the user: skeleton while the request is in flight, a retry
/// card when it fails, an honest empty card, and the shared [OutfitCard] rail
/// (one tap away from [PerfectMatchScreen]) when it succeeds. The rail must
/// never show bundled demo outfits when the engine returned nothing — that is
/// asserted directly on [AppState.recommendedOutfits], which is only ever
/// filled from the endpoint response.
///
/// Everything runs offline: flutter_test's mock HTTP answers 400, which
/// `AppState.loadToday` reports as [AppState.recommendationsError] instead of
/// crashing, and that is exactly the failure state under test. The success
/// state seeds the field the endpoint would have written, because the mock
/// client cannot return a 200 — the live contract itself is verified against a
/// running backend in SECTION5_HOME_INTEGRATION_REPORT.txt.
void main() {
  final state = AppState.instance;

  void reset() {
    state.recommendedOutfits = const [];
    state.recommendationsLoading = false;
    state.recommendationsSettled = false;
    state.recommendationsError = null;
    state.todayOutfit = MockData.todaySelection;
    state.weather = null;
  }

  /// Pins the section in one exact state: `loadToday`'s in-flight guard sees
  /// `recommendationsLoading == true` and returns before it reaches the
  /// network, so a mounted Home cannot overwrite what a test seeded.
  void freeze() => state.recommendationsLoading = true;

  Future<void> pumpHome(WidgetTester tester) async {
    // 432 x 1280 logical: the recommendation section sits below the hero but
    // still inside the viewport, so nothing has to be scrolled into view.
    tester.view.physicalSize = const Size(1080, 3200);
    tester.view.devicePixelRatio = 2.5;
    addTearDown(tester.view.reset);

    await tester.pumpWidget(
      MaterialApp(home: HomeScreen(onOpenTab: (_) {})),
    );
  }

  /// Home also schedules the (unrelated) `loadWardrobe` fetch, whose
  /// `ApiClient` timeout timer only expires after `ApiConfig.timeout` (8 s).
  /// Tests that never let that request settle must burn the clock themselves,
  /// otherwise the timer outlives the test and the framework fails it. Only
  /// the fake clock moves — no recommendation request is waiting on it, since
  /// the ones under test are either already settled or frozen by [freeze].
  Future<void> drainTimeouts(WidgetTester tester) async {
    await tester.pump(const Duration(seconds: 9));
    await tester.pump();
  }

  setUp(reset);
  tearDown(reset);

  testWidgets('skeleton rail while the recommendation request is in flight',
      (tester) async {
    freeze();
    await pumpHome(tester);
    await tester.pump();

    expect(find.text('Recommended for You'), findsOneWidget);
    expect(find.byKey(const ValueKey('home_rec_skeleton')), findsOneWidget);
    expect(find.byType(OutfitCard), findsNothing);
    // The deferred load never got past the guard, so nothing has settled yet
    // and no outfit of any kind is on screen.
    expect(state.recommendationsSettled, isFalse);
    expect(find.text('Effortless Everyday'), findsNothing);
    expect(tester.takeException(), isNull);
    await drainTimeouts(tester);
  });

  testWidgets('loadToday refuses to start a second in-flight request',
      (tester) async {
    freeze();
    await state.loadToday();

    expect(state.recommendationsLoading, isTrue,
        reason: 'the guard must return before it touches any flag');
    expect(state.recommendationsSettled, isFalse);
    expect(state.recommendationsError, isNull);
    expect(state.recommendedOutfits, isEmpty);
    expect(tester.takeException(), isNull);
  });

  testWidgets('failed request shows the API error and a working Retry',
      (tester) async {
    await pumpHome(tester);
    await tester.pump();
    // flutter_test's mock client answers 400, so the deferred load settles
    // into the failure state without any backend running.
    await tester.pumpAndSettle();

    expect(state.recommendationsSettled, isTrue);
    expect(state.recommendationsError, isNotEmpty);
    expect(find.byKey(const ValueKey('home_rec_error')), findsOneWidget);
    expect(find.text("Couldn't load recommendations"), findsOneWidget);
    expect(find.text(state.recommendationsError!), findsOneWidget);
    expect(find.text('Retry'), findsOneWidget);
    // Failure must not fall back to demo outfits.
    expect(state.recommendedOutfits, isEmpty);
    expect(find.byType(OutfitCard), findsNothing);

    await tester.ensureVisible(find.text('Retry'));
    await tester.tap(find.text('Retry'));
    await tester.pumpAndSettle();

    expect(find.byKey(const ValueKey('home_rec_error')), findsOneWidget,
        reason: 'Retry must re-run the request without throwing');
    expect(tester.takeException(), isNull);
    await drainTimeouts(tester);
  });

  testWidgets('engine outfits render in order and open PerfectMatchScreen',
      (tester) async {
    final outfits = [
      for (final raw in const [_engineOutfitA, _engineOutfitB])
        Outfit.fromJson(raw),
    ];
    // Two-score contract: the badge shows the explained compatibility (which
    // `match` mirrors), never the ranking number that orders the rail.
    expect(outfits.first.displayMatch, 89,
        reason: 'the UI shows compatibilityScore, not the ranking score');
    expect(outfits.first.match, 89,
        reason: 'match is a backward-compatible alias of compatibilityScore');
    expect(outfits.first.rankingScore, 72);
    expect(outfits.first.displayMatch, isNot(outfits.first.rankingScore),
        reason: 'the ranking score must never label the Match %');
    state.recommendedOutfits = outfits;
    state.recommendationsSettled = true;
    freeze();
    await pumpHome(tester);
    await tester.pump();

    expect(find.byKey(const ValueKey('home_rec_rail')), findsOneWidget);
    expect(find.byType(OutfitCard), findsNWidgets(outfits.length));
    // The seeded engine outfits, not the bundled hero: Home still shows
    // MockData's "Classic Minimalist Outfit" as today's pick, and the rail
    // shows the endpoint's own names.
    expect(find.text('Effortless Everyday'), findsNWidgets(2));
    expect(find.byType(PerfectMatchScreen), findsNothing);

    await tester.ensureVisible(find.byType(OutfitCard).first);
    await tester.tap(find.byType(OutfitCard).first);
    await tester.pumpAndSettle();

    expect(find.byType(PerfectMatchScreen), findsOneWidget);
    expect(tester.takeException(), isNull);
    await drainTimeouts(tester);
  });

  testWidgets('empty answer shows the empty card, never demo outfits',
      (tester) async {
    freeze();
    state.recommendationsSettled = true;
    await pumpHome(tester);
    await tester.pump();
    expect(find.byKey(const ValueKey('home_rec_skeleton')), findsOneWidget);

    // Settle the frozen request exactly the way loadToday's `finally` does.
    state.recommendationsLoading = false;
    state.notifyListeners();
    await tester.pump();

    expect(find.byKey(const ValueKey('home_rec_empty')), findsOneWidget);
    expect(find.text('No recommendations yet'), findsOneWidget);
    expect(find.text('Refresh'), findsOneWidget);
    expect(find.byType(OutfitCard), findsNothing);
    expect(state.recommendedOutfits, isEmpty);
    expect(tester.takeException(), isNull);
    await drainTimeouts(tester);
  });
}

/// First look returned by `GET /outfits/recommended?occasion=casual&tempC=24&count=4`
/// against a live backend (§5 runtime check), reproduced as served. `items[]`
/// is omitted — the Flutter `Outfit` model does not map it — everything else,
/// including the engine's own breakdown weights, is byte-for-byte.
///
/// The engine serves the compatibility and ranking scores separately on one
/// outfit: `compatibilityScore` (the explained 11-factor number the UI displays,
/// which `match` mirrors as a backward-compatible alias) and `rankingScore`
/// (the engine's internal ordering score). Here an 89-compatibility look is
/// ranked at 72 — the rail orders by 72 but the badge shows 89.
const Map<String, dynamic> _engineOutfitA = {
  'id': 'gen-1791398415503-3',
  'name': 'Effortless Everyday',
  'occasion': 'casual',
  'match': 89,
  'compatibilityScore': 89,
  'rankingScore': 72,
  'breakdown': [
    {'key': 'color_harmony', 'label': 'Color Harmony', 'value': 99, 'weight': 0.1839, 'applied': true, 'contribution': 18.2},
    {'key': 'occasion_fit', 'label': 'Occasion Fit', 'value': 86, 'weight': 0.1609, 'applied': true, 'contribution': 13.9},
    {'key': 'personal_preference', 'label': 'Personal Taste', 'value': 86, 'weight': 0.1609, 'applied': true, 'contribution': 13.8},
    {'key': 'weather_match', 'label': 'Weather Match', 'value': 91, 'weight': 0.1379, 'applied': true, 'contribution': 12.6},
    {'key': 'style_compatibility', 'label': 'Style Compatibility', 'value': 60, 'weight': 0.1494, 'applied': true, 'contribution': 9},
    {'key': 'season_match', 'label': 'Season Match', 'value': 75, 'weight': 0.092, 'applied': true, 'contribution': 6.9},
    {'key': 'recent_usage', 'label': 'Recent Usage', 'value': 88, 'weight': 0.069, 'applied': true, 'contribution': 6.1},
    {'key': 'wardrobe_availability', 'label': 'Wardrobe Availability', 'value': 100, 'weight': 0.0345, 'applied': true, 'contribution': 3.4},
    {'key': 'trend_compatibility', 'label': 'Trend Compatibility', 'value': 85, 'weight': 0.0115, 'applied': true, 'contribution': 1},
    {'key': 'body_fit_preference', 'label': 'Fit Preference', 'value': 80, 'weight': 0, 'applied': false, 'contribution': 0},
    {'key': 'user_feedback', 'label': 'Your Feedback', 'value': 75, 'weight': 0, 'applied': false, 'contribution': 0},
  ],
  'explanation': 'Oxford Cotton Shirt + Beige Chinos + Minimalist Sneakers + Silk Scarf — White / Beige / Multicolor reads as one deliberate palette, and layering handles the temperature. Overall match 89%.',
  'itemIds': ['w1', 'w11', 'w4', 'w10'],
  'pieces': ['Oxford Cotton Shirt', 'Beige Chinos', 'Minimalist Sneakers', 'Silk Scarf'],
  'image': 'assets/images/item_shirt_white_soft.jpg',
};

/// Second look from the same response (ranking 71, compatibility 92).
const Map<String, dynamic> _engineOutfitB = {
  'id': 'gen-1791398415501-0',
  'name': 'Effortless Everyday',
  'occasion': 'casual',
  'match': 92,
  'compatibilityScore': 92,
  'rankingScore': 71,
  'breakdown': [
    {'key': 'color_harmony', 'label': 'Color Harmony', 'value': 93, 'weight': 0.1839, 'applied': true, 'contribution': 17.1},
    {'key': 'occasion_fit', 'label': 'Occasion Fit', 'value': 92, 'weight': 0.1609, 'applied': true, 'contribution': 14.8},
    {'key': 'personal_preference', 'label': 'Personal Taste', 'value': 86, 'weight': 0.1609, 'applied': true, 'contribution': 13.8},
    {'key': 'style_compatibility', 'label': 'Style Compatibility', 'value': 92, 'weight': 0.1494, 'applied': true, 'contribution': 13.7},
    {'key': 'weather_match', 'label': 'Weather Match', 'value': 93, 'weight': 0.1379, 'applied': true, 'contribution': 12.8},
    {'key': 'season_match', 'label': 'Season Match', 'value': 75, 'weight': 0.092, 'applied': true, 'contribution': 6.9},
    {'key': 'recent_usage', 'label': 'Recent Usage', 'value': 72, 'weight': 0.069, 'applied': true, 'contribution': 5},
    {'key': 'wardrobe_availability', 'label': 'Wardrobe Availability', 'value': 100, 'weight': 0.0345, 'applied': true, 'contribution': 3.4},
    {'key': 'trend_compatibility', 'label': 'Trend Compatibility', 'value': 85, 'weight': 0.0115, 'applied': true, 'contribution': 1},
    {'key': 'body_fit_preference', 'label': 'Fit Preference', 'value': 80, 'weight': 0, 'applied': false, 'contribution': 0},
    {'key': 'user_feedback', 'label': 'Your Feedback', 'value': 75, 'weight': 0, 'applied': false, 'contribution': 0},
  ],
  'explanation': 'Oxford Cotton Shirt + Beige Chinos + Minimalist Sneakers + Minimalist Leather Belt — White / Beige / Tan reads as one deliberate palette, and layering handles the temperature. Overall match 92%.',
  'itemIds': ['w1', 'w11', 'w4', 'w6'],
  'pieces': ['Oxford Cotton Shirt', 'Beige Chinos', 'Minimalist Sneakers', 'Minimalist Leather Belt'],
  'image': 'assets/images/item_shirt_white_soft.jpg',
};
