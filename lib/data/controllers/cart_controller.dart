import 'package:flutter/foundation.dart';

import '../../core/api/smartwardrobe_api.dart';
import '../backend_status.dart';
import '../models.dart';

/// One cart line: a shop pick plus how many of it the user wants.
class CartEntry {
  CartEntry({required this.pick, this.qty = 1});

  final ShoppingPick pick;
  int qty;
}

/// Shopping cart for the simulated checkout.
///
/// The cart itself is session state (like the wishlist taps before they
/// persist); placing the order goes through `POST /shop/checkout`, which
/// re-prices everything server-side and stores the order as `simulated`.
class CartController extends ChangeNotifier {
  CartController({
    required SmartWardrobeApi api,
    required BackendStatus status,
  })  : _api = api,
        _status = status;

  final SmartWardrobeApi _api;
  final BackendStatus _status;

  final List<CartEntry> entries = [];
  bool placing = false;

  int get count => entries.fold(0, (sum, e) => sum + e.qty);

  void add(ShoppingPick pick) {
    final existing = entries.where((e) => e.pick.id == pick.id);
    if (existing.isNotEmpty) {
      existing.first.qty = (existing.first.qty + 1).clamp(1, 5);
    } else {
      entries.add(CartEntry(pick: pick));
    }
    notifyListeners();
  }

  void remove(CartEntry entry) {
    entries.remove(entry);
    notifyListeners();
  }

  void setQty(CartEntry entry, int qty) {
    entry.qty = qty.clamp(1, 5);
    if (qty < 1) entries.remove(entry);
    notifyListeners();
  }

  void clear() {
    entries.clear();
    notifyListeners();
  }

  /// Display total, parsed from the picks' formatted prices ("1,450 EGP").
  /// The server is authoritative: checkout re-prices every line.
  String get totalText {
    var total = 0.0;
    var currency = '';
    for (final e in entries) {
      final m = RegExp(r'([\d,]+(?:\.\d+)?)\s*([A-Za-z]{3})?')
          .firstMatch(e.pick.price);
      if (m != null) {
        total += (double.tryParse(m.group(1)!.replaceAll(',', '')) ?? 0) *
            e.qty;
        if (m.group(2) != null) currency = m.group(2)!;
      }
    }
    final grouped = total
        .toStringAsFixed(0)
        .replaceAllMapped(RegExp(r'(\d)(?=(\d{3})+\b)'), (m) => '${m[1]},');
    return currency.isEmpty ? grouped : '$grouped $currency';
  }

  /// Place the order (simulated). Returns the order map on success, null on
  /// failure (offline / validation error); the cart is kept on failure.
  Future<Map<String, dynamic>?> checkout({
    String? name,
    String? phone,
    String? address,
  }) async {
    if (entries.isEmpty || placing) return null;
    placing = true;
    notifyListeners();
    try {
      final res = await _api.shopCheckout({
        'items': [
          for (final e in entries)
            {'shoppingItemId': e.pick.id ?? '', 'qty': e.qty},
        ],
        if (name != null && name.trim().isNotEmpty) 'name': name.trim(),
        if (phone != null && phone.trim().isNotEmpty) 'phone': phone.trim(),
        if (address != null && address.trim().isNotEmpty)
          'address': address.trim(),
      });
      final order = res['order'];
      if (order is Map) {
        clear();
        _status.markOnline();
        return Map<String, dynamic>.from(order);
      }
      return null;
    } catch (e) {
      _status.markOffline(e);
      return null;
    } finally {
      placing = false;
      notifyListeners();
    }
  }
}
