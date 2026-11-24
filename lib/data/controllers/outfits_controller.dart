import 'package:flutter/foundation.dart';

import '../../core/api/smartwardrobe_api.dart';
import '../../core/location/device_location.dart';
import '../backend_status.dart';
import '../models.dart';
import '../dto/mappers.dart';

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
    try {
      final outfits = await _api.recommendedOutfits(occasion: occasion, count: 1);
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
      final live = await _loadLiveWeather();
      if (live != null) weather = live;
      _status.markOnline();
      notifyListeners();
    } catch (e) {
      _status.markOffline(e);
      if (outfitsOk) notifyListeners();
    }
  }

  Future<Map<String, dynamic>?> _loadLiveWeather() async {
    try {
      final coords = await currentCoords();
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
