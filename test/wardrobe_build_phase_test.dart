import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:smartwardrobe/data/app_state.dart';
import 'package:smartwardrobe/features/wardrobe/wardrobe_screen.dart';

/// Regression for "setState()/markNeedsBuild() called during build".
///
/// `WardrobeScreen.initState` used to call `_state.loadWardrobe()`
/// synchronously. `loadWardrobe` sets `wardrobeLoading = true` and calls
/// `notifyListeners()` before its first await, so when the screen opens on top
/// of an already-mounted listener (a pushed route, or a tab built over the
/// shell), the framework threw "markNeedsBuild() called during build" — and
/// because the call was async, the exception was captured into an unhandled
/// Future error that aborted the load before any fetch. The wardrobe stayed
/// on its initial state with `wardrobeLoading` never resetting.
///
/// The first load is now deferred with `addPostFrameCallback`, so the
/// synchronous notification can no longer happen mid-build and the load
/// always completes. This test mounts a listener below the route, then pushes
/// WardrobeScreen on top — the topology that triggered the bug — and asserts
/// the load actually completed. It runs offline too (flutter_test's mock HTTP
/// answers 400, which loadWardrobe treats as "offline").
void main() {
  testWidgets('WardrobeScreen load is not aborted by a mid-build notification',
      (tester) async {
    tester.view.physicalSize = const Size(1080, 2340);
    tester.view.devicePixelRatio = 2.5;
    addTearDown(tester.view.reset);

    final nav = GlobalKey<NavigatorState>();
    await tester.pumpWidget(
      MaterialApp(
        navigatorKey: nav,
        home: Scaffold(
          body: ListenableBuilder(
            listenable: AppState.instance,
            builder: (_, _) => const Text('home'),
          ),
        ),
      ),
    );

    // Open the wardrobe like the app does: pushed onto the navigation stack
    // while earlier screens keep their ListenableBuilder mounted.
    nav.currentState!.push(
      MaterialPageRoute<void>(builder: (_) => const WardrobeScreen()),
    );
    await tester.pump();
    await tester.pumpAndSettle();

    // A synchronous notify from initState would throw mid-build (old code);
    // even captured into an async zone it aborted the load, leaving the flag
    // stuck at true. The deferred load must run to completion instead.
    expect(AppState.instance.wardrobeLoading, isFalse,
        reason: 'loadWardrobe must complete, not abort during the build phase');
    expect(tester.takeException(), isNull);
  });
}