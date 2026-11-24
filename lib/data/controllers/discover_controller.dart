import 'package:flutter/foundation.dart';

import '../../core/api/smartwardrobe_api.dart';
import '../backend_status.dart';
import '../dto/mappers.dart';
import '../models.dart';

/// Database-backed editorial content for the Discover tab.
class DiscoverController extends ChangeNotifier {
  DiscoverController({
    required SmartWardrobeApi api,
    required BackendStatus status,
  })  : _api = api,
        _status = status;

  final SmartWardrobeApi _api;
  final BackendStatus _status;

  bool loading = false;
  DiscoverContent content = DiscoverContent.empty;

  Future<void> load() async {
    loading = true;
    notifyListeners();
    try {
      final res = await _api.discoverContent();
      content = discoverContentFromJson(res);
      _status.markOnline();
    } catch (e) {
      _status.markOffline(e);
      content = DiscoverContent.empty;
    } finally {
      loading = false;
      notifyListeners();
    }
  }

  void reset() {
    loading = false;
    content = DiscoverContent.empty;
  }
}
