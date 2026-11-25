import 'package:flutter/foundation.dart';

import '../../core/api/smartwardrobe_api.dart';
import '../assets.dart';
import '../backend_status.dart';
import '../models.dart';

/// Shopping recommendations.
class ShopController extends ChangeNotifier {
  ShopController({
    required SmartWardrobeApi api,
    required BackendStatus status,
  })  : _api = api,
        _status = status;

  final SmartWardrobeApi _api;
  final BackendStatus _status;

  SmartWardrobeApi get api => _api;

  List<ShoppingPick> picks = [];

  Future<void> load() async {
    try {
      final res = await _api.shopRecommended();
      final rows = (res['picks'] as List?) ?? const [];
      picks = [
        for (final j in rows)
          ShoppingPick(
            name: '${(j as Map)['name'] ?? ''}',
            price: _formatPrice(j),
            image: '${(j)['imageUrl'] ?? (j)['image'] ?? Img.teeWhite}',
            reason: '${(j)['reason'] ?? ''}',
          ),
      ];
      _status.markOnline();
      notifyListeners();
    } catch (e) {
      _status.markOffline(e);
    }
  }

  void reset() {
    picks = [];
  }

  /// "1,450 EGP" from the API's price + currency; falls back to the raw
  /// price string for legacy rows with no currency.
  static String _formatPrice(Map j) {
    final raw = j['price'];
    final currency = '${j['currency'] ?? ''}'.trim();
    if (raw is num) {
      final grouped = raw
          .toStringAsFixed(0)
          .replaceAllMapped(RegExp(r'(\d)(?=(\d{3})+\b)'), (m) => '${m[1]},');
      return currency.isEmpty ? grouped : '$grouped $currency';
    }
    return '${raw ?? ''}';
  }
}
