import 'package:flutter/foundation.dart';

import '../../core/api/smartwardrobe_api.dart';
import '../backend_status.dart';
import '../dto/mappers.dart';
import '../models.dart';

/// Style DNA breakdown computed from the user's database records.
class InsightsController extends ChangeNotifier {
  InsightsController({
    required SmartWardrobeApi api,
    required BackendStatus status,
  })  : _api = api,
        _status = status;

  final SmartWardrobeApi _api;
  final BackendStatus _status;

  bool loading = false;
  StyleDna styleDna = StyleDna.empty;

  Future<void> loadStyleDna() async {
    loading = true;
    notifyListeners();
    try {
      final res = await _api.styleDnaInsights();
      styleDna = styleDnaFromJson(res);
      _status.markOnline();
    } catch (e) {
      _status.markOffline(e);
      styleDna = StyleDna.empty;
    } finally {
      loading = false;
      notifyListeners();
    }
  }

  void reset() {
    loading = false;
    styleDna = StyleDna.empty;
  }
}
