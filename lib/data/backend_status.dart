import 'package:flutter/foundation.dart';

import '../core/api/api_client.dart';

/// Connectivity state shared by every feature controller.
///
/// A failed request is not automatically an offline backend: a 401, a 422 or a
/// 500 means the server answered, and treating those as "offline" makes the UI
/// lie about the cause. Only transport failures (no HTTP status) flip [online].
class BackendStatus extends ChangeNotifier {
  bool online = false;
  String? lastError;

  void markOnline() {
    if (online) return;
    online = true;
    notifyListeners();
  }

  void markOffline(Object error) {
    final message = error.toString();
    final transportFailure = error is ApiException && error.status == null;
    final changed = message != lastError || (transportFailure && online);
    lastError = message;
    if (transportFailure && online) online = false;
    if (changed) notifyListeners();
  }

  void reset() {
    online = false;
    lastError = null;
    notifyListeners();
  }
}
