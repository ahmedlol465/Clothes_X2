import 'package:flutter/foundation.dart';

import '../../core/api/smartwardrobe_api.dart';
import '../assets.dart';
import '../backend_status.dart';
import '../models.dart';

/// Weekly planner and travel packing.
class PlannerController extends ChangeNotifier {
  PlannerController({
    required SmartWardrobeApi api,
    required BackendStatus status,
  })  : _api = api,
        _status = status;

  final SmartWardrobeApi _api;
  final BackendStatus _status;

  List<Map<String, dynamic>> week = [];
  List<Map<String, dynamic>> events = [];

  List<PackingEntry> packing = [];
  String packingMessage = '';

  Future<void> loadEvents() async {
    try {
      final rows = await _api.events();
      events = [
        for (final row in rows) Map<String, dynamic>.from(row as Map),
      ];
      _status.markOnline();
      notifyListeners();
    } catch (e) {
      _status.markOffline(e);
    }
  }

  Future<void> loadWeek() async {
    try {
      final plan = await _api.weeklyPlan();
      week = [
        for (final j in plan) Map<String, dynamic>.from(j as Map),
      ];
      _status.markOnline();
      notifyListeners();
    } catch (e) {
      _status.markOffline(e);
    }
  }

  Future<void> loadPacking({
    String destination = 'Istanbul',
    int days = 7,
  }) async {
    try {
      final res = await _api.travelPacking(
        destination: destination,
        days: days,
      );
      final items = (res['items'] as List?) ?? const [];
      packing = [
        for (final j in items)
          PackingEntry(
            name: '${(j as Map)['name'] ?? ''}',
            image: '${(j)['image'] ?? Img.teeWhite}',
          ),
      ];
      packingMessage = '${res['message'] ?? ''}';
      _status.markOnline();
      notifyListeners();
    } catch (e) {
      _status.markOffline(e);
    }
  }

  void reset() {
    week = [];
    events = [];
    packing = [];
    packingMessage = '';
  }
}
