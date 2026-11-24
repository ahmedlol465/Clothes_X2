import 'package:flutter/foundation.dart';

/// Base URL resolution for the SmartWardrobe backend (§5 Technical Architecture).
///
/// - Android emulator → host machine is `10.0.2.2`
/// - iOS simulator / desktop / web → `localhost`
/// Override with `--dart-define=API_BASE_URL=http://<lan-ip>:3002` to run on
/// a physical device (e.g. `--dart-define=API_BASE_URL=http://192.168.1.5:3002`).
/// The phone and the PC must be on the same Wi-Fi, and the backend must be
/// running (`npm run dev` in backend/).
abstract final class ApiConfig {
  static const String _envUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: '',
  );

  /// The NestJS API is mounted under `API_PREFIX` (default `api`), so every
  /// path in [SmartWardrobeApi] (`/auth/login`, `/wardrobe/items`, …) is
  /// resolved relative to `<origin>/api`.
  static const String _apiPrefix = '/api';

  static String get baseUrl {
    final origin = _envUrl.isNotEmpty
        ? _envUrl
        : (!kIsWeb && defaultTargetPlatform == TargetPlatform.android
            ? 'http://10.0.2.2:3002'
            : 'http://localhost:3002');
    if (origin.endsWith(_apiPrefix)) return origin;
    final trimmed = origin.endsWith('/')
        ? origin.substring(0, origin.length - 1)
        : origin;
    return '$trimmed$_apiPrefix';
  }

  /// Budget for ordinary CRUD. The backend answers these in well under 100ms,
  /// so a short cap is what turns a genuine hang into a fast, honest error.
  static const Duration timeout = Duration(seconds: 8);

  /// Budget for the AI endpoints, which are a different order of magnitude.
  ///
  /// The stylist calls a free-tier LLM and then falls back to the rule engine,
  /// so a legitimate response takes 5-25s depending on how busy the tier is.
  /// Capping those at [timeout] meant the app threw "Backend unreachable" at a
  /// server that was about to answer normally — the request was aborted by the
  /// client, not failed by the backend.
  ///
  /// This is deliberately longer than the server's own worst case (~30s: the
  /// LLM budget plus context assembly). The server always replies before this
  /// expires, so a real hang still surfaces promptly.
  static const Duration aiTimeout = Duration(seconds: 45);

  /// Style/vision analyzes can take up to ~30s on a cold model load, and a
  /// cold ONNX load on a slow disk has been measured at ~65s. The gate verdict
  /// must not be dropped on the shared 8s budget, or a rejected photo would be
  /// reported as an upload timeout instead of a real "not clothing" verdict.
  static const Duration analyzeTimeout = Duration(seconds: 90);

  /// Uploads carry photo bytes — allow a full minute.
  static const Duration uploadTimeout = Duration(seconds: 60);
}
