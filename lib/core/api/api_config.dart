import 'package:flutter/foundation.dart';

/// Base URL resolution for the SmartWardrobe backend (§5 Technical Architecture).
///
/// - Android emulator → host machine is `10.0.2.2`
/// - iOS simulator / desktop / web → `localhost`
/// Override with `--dart-define=API_BASE_URL=http://<lan-ip>:3001` to run on
/// a physical device (e.g. `--dart-define=API_BASE_URL=http://192.168.1.5:3001`).
/// The phone and the PC must be on the same Wi-Fi, and the backend must be
/// running (`npm start` in backend/).
abstract final class ApiConfig {
  static const String _envUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: '',
  );

  static String get baseUrl {
    if (_envUrl.isNotEmpty) return _envUrl;
    if (!kIsWeb &&
        defaultTargetPlatform == TargetPlatform.android) {
      return 'http://10.0.2.2:3001';
    }
    return 'http://localhost:3001';
  }

  static const Duration timeout = Duration(seconds: 8);

  /// Style/vision analyzes can take up to ~30s on a cold model load. The gate
  /// verdict must not be dropped on the shared 8s budget, or a rejected photo
  /// would fall back to heuristic tags and be saved as clothing.
  static const Duration analyzeTimeout = Duration(seconds: 60);

  /// Uploads carry photo bytes — allow a full minute.
  static const Duration uploadTimeout = Duration(seconds: 60);
}
