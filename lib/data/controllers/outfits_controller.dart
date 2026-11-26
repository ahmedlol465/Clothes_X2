import 'package:flutter/foundation.dart';

import '../../core/api/smartwardrobe_api.dart';
import '../../core/location/device_location.dart';
import '../backend_status.dart';
import '../models.dart';
import '../dto/mappers.dart';

/// Outcome of [OutfitsController.createOutfit].
enum SaveOutfitResult {
  /// The outfit was persisted and the saved grid refreshed.
  saved,

  /// An identical outfit (same name, occasion and ordered items) is already
  /// saved, so no second record was created.
  duplicate,

  /// The save failed; the backend status carries the reason.
  failed,
}

/// Outfits, today's pick, live weather and compatibility scoring.
class OutfitsController extends ChangeNotifier {
  OutfitsController({
    required SmartWardrobeApi api,
    required BackendStatus status,
  })  : _api = api,
        _status = status;

  final SmartWardrobeApi _api;
  final BackendStatus _status;

  SmartWardrobeApi get api => _api;

  List<Outfit> saved = [];
  Outfit? today;
  Map<String, dynamic>? weather;

  Future<void> loadSaved() async {
    try {
      final res = await _api.outfits();
      saved = [
        for (final j in res)
          outfitFromJson(Map<String, dynamic>.from(j as Map)),
      ];
      _status.markOnline();
      notifyListeners();
    } catch (e) {
      _status.markOffline(e);
    }
  }

  /// Today's pick + live weather. The two loads are independent: a failing
  /// outfit call must never pin the weather pill, and vice versa.
  Future<void> loadToday({String occasion = 'casual'}) async {
    var outfitsOk = false;
    // One GPS fix feeds both the recommendation and the weather pill so the
    // outfit is picked for the same weather the card shows.
    final coords = await currentCoords();
    try {
      final outfits = await _api.recommendedOutfits(
        occasion: occasion,
        count: 1,
        lat: coords?.lat,
        lon: coords?.lon,
      );
      if (outfits.isNotEmpty) {
        today = outfitFromJson(
          Map<String, dynamic>.from(outfits.first as Map),
        );
      }
      outfitsOk = true;
    } catch (e) {
      _status.markOffline(e);
    }
    try {
      final live = await _loadLiveWeather(coords);
      if (live != null) weather = live;
      _status.markOnline();
      notifyListeners();
    } catch (e) {
      _status.markOffline(e);
      if (outfitsOk) notifyListeners();
    }
  }

  Future<Map<String, dynamic>?> _loadLiveWeather(
    ({double lat, double lon})? coords,
  ) async {
    try {
      if (coords != null) {
        return await _api.weather(lat: coords.lat, lon: coords.lon);
      }
    } catch (_) {
      // GPS failed — fall through to the IP lookup below.
    }
    try {
      final ip = await ipCoords();
      if (ip != null) {
        return await _api.weather(city: ip.city, lat: ip.lat, lon: ip.lon);
      }
    } catch (_) {
      // IP lookup failed — fall through to the default city below.
    }
    return _api.weather();
  }

  Future<Map<String, dynamic>?> compatibility(
    List<String> itemIds, {
    String occasion = 'casual',
  }) async {
    try {
      final res = await _api.compatibility(itemIds, occasion: occasion);
      _status.markOnline();
      return res;
    } catch (e) {
      _status.markOffline(e);
      return null;
    }
  }

  /// Identity used to collapse repeated saves: two outfits are "the same save"
  /// when they share a trimmed [Outfit.name], a case-insensitive trimmed
  /// [Outfit.occasion] and the exact same ordered [Outfit.itemIds].
  ///
  /// The rule is deliberately strict (all three fields, order-sensitive) so it
  /// can only ever under-merge: two genuinely different outfits are never
  /// collapsed into one.
  static bool sameOutfit(Outfit a, Outfit b) {
    if (a.name.trim() != b.name.trim()) return false;
    if (a.occasion.trim().toLowerCase() != b.occasion.trim().toLowerCase()) {
      return false;
    }
    final x = a.itemIds ?? const <String>[];
    final y = b.itemIds ?? const <String>[];
    if (x.length != y.length) return false;
    for (var i = 0; i < x.length; i++) {
      if (x[i] != y[i]) return false;
    }
    return true;
  }

  /// Saves a user-created outfit (§8.5 `POST /outfits`) and refreshes [saved]
  /// so the new outfit shows up in the Saved grid without leaving the screen.
  ///
  /// The backend scores the selected pieces itself, so only the name, the
  /// item ids and the occasion cross the wire. Repeated saves of the exact
  /// same outfit are collapsed: the current list is refreshed first, and when
  /// [sameOutfit] matches an existing entry the POST is skipped and
  /// [SaveOutfitResult.duplicate] is returned, so a double tap cannot mint a
  /// second identical record. Any failure returns [SaveOutfitResult.failed].
  Future<SaveOutfitResult> createOutfit({
    required String name,
    required List<String> itemIds,
    String occasion = 'Casual',
  }) async {
    if (name.trim().isEmpty || itemIds.isEmpty) {
      return SaveOutfitResult.failed;
    }
    final candidate = Outfit(
      id: '',
      name: name,
      image: '',
      occasion: occasion,
      match: 0,
      pieces: const <String>[],
      itemIds: itemIds,
    );
    // Refresh against the server before deciding, so the duplicate check does
    // not trust a stale cache. When the refresh fails the POST below fails
    // too, so the duplicate check is simply skipped offline.
    await loadSaved();
    if (saved.any((o) => sameOutfit(o, candidate))) {
      return SaveOutfitResult.duplicate;
    }
    try {
      await _api.createOutfit(name, itemIds, occasion: occasion);
      _status.markOnline();
      await loadSaved();
      return SaveOutfitResult.saved;
    } catch (e) {
      _status.markOffline(e);
      return SaveOutfitResult.failed;
    }
  }

  Future<bool> toggleFavorite(Outfit outfit) async {
    try {
      await _api.toggleFavorite(outfit.id);
      _status.markOnline();
      await loadSaved();
      return true;
    } catch (e) {
      _status.markOffline(e);
      return false;
    }
  }

  Future<Outfit?> remix(List<String> itemIds, String variant) async {
    if (itemIds.isEmpty) return null;
    try {
      final res = await _api.remix(itemIds, variant);
      final outfit = res['outfit'];
      _status.markOnline();
      return outfit is Map
          ? outfitFromJson(Map<String, dynamic>.from(outfit))
          : null;
    } catch (e) {
      _status.markOffline(e);
      return null;
    }
  }

  Future<bool> feedback(Outfit outfit, {int rating = 5}) async {
    try {
      await _api.outfitFeedback(outfit.id, rating: rating);
      _status.markOnline();
      return true;
    } catch (e) {
      _status.markOffline(e);
      return false;
    }
  }

  void reset() {
    saved = [];
    today = null;
    weather = null;
  }
}
