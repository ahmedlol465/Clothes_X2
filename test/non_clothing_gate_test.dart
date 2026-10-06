import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:smartwardrobe/core/api/api_client.dart';
import 'package:smartwardrobe/data/app_state.dart';

/// End-to-end regression for the clothing gate on the real Node/AI path.
///
/// Before this fix, `AppState.stagePhoto` swallowed the backend's 422
/// rejection with a bare `catch (_)` and returned an empty "heuristic"
/// analysis. The Add Clothes screen then filled default garment tags
/// (White / Tops / Casual / Cotton) and a bottle or a chair could be saved
/// as clothing. These tests drive the exact app path ([stagePhoto] →
/// `POST /wardrobe/upload` → `POST /ai/analyze-clothing`) against the live
/// backend and require the rejection to surface as an [ApiException].
///
/// Skips gracefully when the backend is not running (same convention as
/// `backend_contract_test.dart`).
void main() {
  final base = Platform.environment['API_BASE_URL'] ?? 'http://localhost:3001';

  Future<bool> backendUp() async {
    final client = HttpClient();
    try {
      final req = await client.getUrl(Uri.parse('$base/health'));
      final res = await req.close();
      await res.drain<void>();
      return res.statusCode < 400;
    } catch (_) {
      return false;
    } finally {
      client.close();
    }
  }

  Future<Set<String>> storageNames() async {
    final dir = Directory('backend/storage');
    if (!await dir.exists()) return <String>{};
    final names = <String>{};
    await for (final e in dir.list()) {
      names.add(e.path.split(Platform.pathSeparator).last);
    }
    return names;
  }

  /// Removes test-uploaded files so the storage snapshot stays untouched.
  Future<void> deleteUploads(Set<String> before) async {
    final after = await storageNames();
    for (final name in after.difference(before)) {
      final f = File('backend/storage${Platform.pathSeparator}$name');
      try {
        await f.delete();
      } catch (_) {}
    }
  }

  // Every test uploads through stagePhoto; clean each one right after so the
  // backend/storage snapshot ends exactly where it started.
  late Set<String> knownBeforeUpload;
  setUp(() async => knownBeforeUpload = await storageNames());
  tearDown(() async => deleteUploads(knownBeforeUpload));

  test('non-clothing: bottle and chair are rejected through stagePhoto', () async {
    if (!await backendUp()) {
      markTestSkipped('Backend not running at $base. Run backend/npm start.');
      return;
    }
    for (final fixture in const ['bottle.jpg', 'chair.jpg']) {
      final bytes =
          await File('backend/test/fixtures/non-clothing/$fixture')
              .readAsBytes();
      await expectLater(
        AppState.instance.stagePhoto(
          filename: fixture,
          bytes: bytes,
          mimeType: 'image/jpeg',
        ),
        throwsA(
          isA<ApiException>()
              .having((e) => e.status, 'status', 422)
              .having((e) => e.message, 'message', contains('clothing')),
        ),
        reason: '$fixture must be rejected, not staged as default clothing',
      );
    }
  });

  test('clothing: a real garment still stages as clothing-vision', () async {
    if (!await backendUp()) {
      markTestSkipped('Backend not running at $base. Run backend/npm start.');
      return;
    }
    const candidates = <String>[
      'assets/images/blazer_navy_hanger.jpg',
      'assets/images/item_tee_white.jpg',
      'assets/images/sweater_beige_folded.jpg',
      'assets/images/item_jeans_blue.jpg',
      'assets/images/community_green_sweater.jpg',
    ];
    for (final img in candidates) {
      try {
        final bytes = await File(img).readAsBytes();
        final staged = await AppState.instance.stagePhoto(
          filename: img.split('/').last,
          bytes: bytes,
          mimeType: 'image/jpeg',
        );
        expect(staged.source, 'clothing-vision',
            reason: '$img must be analyzed by the real vision path');
        expect(staged.analysis['success'], true,
            reason: '$img must be accepted by the gate');
        expect(staged.url, startsWith('http://'));
        return;
      } on ApiException catch (e) {
        if (e.status == null) rethrow;
        // The gate may deliberately decline a specific asset (model
        // decision) — try the next candidate before failing.
        continue;
      } catch (_) {
        rethrow;
      }
    }
    fail('no clothing asset staged successfully');
  });
}