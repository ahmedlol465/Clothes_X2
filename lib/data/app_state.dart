import 'package:flutter/foundation.dart';

import '../core/api/api_client.dart';
import '../core/api/smartwardrobe_api.dart';
import 'mock_data.dart';
import 'models.dart';

/// Central data store: every screen reads backend data through here and
/// falls back to [MockData] when the backend is unreachable (offline demo).
///
/// Usage: `AppState.instance.loadWardrobe()` then
/// `ListenableBuilder(listenable: AppState.instance, builder: …)`.
class AppState extends ChangeNotifier {
  AppState._();
  static final AppState instance = AppState._();

  final ApiClient _client = ApiClient();
  late final SmartWardrobeApi api = SmartWardrobeApi(_client);

  /// True once a backend call has succeeded at least once.
  bool backendOnline = false;
  bool wardrobeLoading = false;
  String? lastError;

  List<ClothingItem> wardrobe = [...MockData.wardrobe];
  List<String> wardrobeFilters = [...MockData.wardrobeFilters];

  List<Outfit> savedOutfits = [...MockData.savedOutfits];
  Outfit todayOutfit = MockData.todaySelection;
  Map<String, dynamic>? weather;

  Map<String, dynamic>? _user;
  Map<String, dynamic>? get user => _user;

  // ------------------------------------------------------- planner (§8.6)
  List<Map<String, dynamic>> planWeek = [
    for (final d in MockData.planWeek)
      {
        'weekday': d.weekday,
        'date': d.date,
        'occasion': d.occasion,
        'outfitName': d.outfitName,
        'image': d.image,
        'isToday': d.isToday,
      },
  ];

  Future<void> loadWeeklyPlan() async {
    try {
      final week = await api.weeklyPlan();
      if (week.isNotEmpty) {
        planWeek = [
          for (final j in week) Map<String, dynamic>.from(j as Map),
        ];
        notifyListeners();
      }
      _markOnline();
    } catch (e) {
      _markOffline(e);
    }
  }

  // -------------------------------------------------------- travel (§8.6)
  List<PackingEntry> packingItems = [
    for (final p in MockData.packingGroups)
      PackingEntry(name: p.name, image: p.image),
  ];
  String packingMessage =
      '7 distinct outfits can be created from these items.';

  Future<void> loadPacking({String destination = 'Istanbul', int days = 7}) async {
    try {
      final res = await api.travelPacking(
        destination: destination,
        days: days,
      );
      final items = (res['items'] as List?) ?? [];
      if (items.isNotEmpty) {
        packingItems = [
          for (final j in items)
            PackingEntry(
              name: '${(j as Map)['name'] ?? ''}',
              image: '${(j)['image'] ?? 'assets/images/item_tee_white.jpg'}',
            ),
        ];
        packingMessage = '${res['message'] ?? packingMessage}';
        notifyListeners();
      }
      _markOnline();
    } catch (e) {
      _markOffline(e);
    }
  }

  // ------------------------------------------------------- shopping (§8.7)
  List<ShoppingPick> shopPicks = [...MockData.shoppingPicks];

  Future<void> loadShop() async {
    try {
      final res = await api.shopRecommended();
      final picks = (res['picks'] as List?) ?? [];
      if (picks.isNotEmpty) {
        shopPicks = [
          for (final j in picks)
            ShoppingPick(
              name: '${(j as Map)['name'] ?? ''}',
              price: '${(j)['price'] ?? ''}',
              image: '${(j)['image'] ?? 'assets/images/item_tee_white.jpg'}',
              reason: '${(j)['reason'] ?? ''}',
            ),
        ];
        notifyListeners();
      }
      _markOnline();
    } catch (e) {
      _markOffline(e);
    }
  }

  void _markOnline() {
    if (!backendOnline) {
      backendOnline = true;
      notifyListeners();
    }
  }

  void _markOffline(Object e) {
    lastError = e.toString();
    if (backendOnline) {
      backendOnline = false;
      notifyListeners();
    }
  }

  // ------------------------------------------------------------ auth (§8.1)
  Future<bool> login(String email, String password) async {
    try {
      final res = await api.login(email, password);
      _user = res['user'] as Map<String, dynamic>?;
      _markOnline();
      notifyListeners();
      return true;
    } catch (e) {
      _markOffline(e);
      return false;
    }
  }

  Future<bool> register(String name, String email, String password) async {
    try {
      final res = await api.register(name, email, password);
      _user = res['user'] as Map<String, dynamic>?;
      _markOnline();
      notifyListeners();
      return true;
    } catch (e) {
      _markOffline(e);
      return false;
    }
  }

  // ------------------------------------------------------- wardrobe (§8.3)
  Future<void> loadWardrobe({String search = '', String category = 'All'}) async {
    wardrobeLoading = true;
    notifyListeners();
    try {
      final res = await api.wardrobeItems(search: search, category: category);
      wardrobe = [
        for (final j in (res['items'] as List))
          ClothingItem.fromJson(Map<String, dynamic>.from(j as Map)),
      ];
      final cats = (res['categories'] as List?)?.map((c) => '$c').toList();
      if (cats != null && cats.isNotEmpty) wardrobeFilters = cats;
      _markOnline();
    } catch (e) {
      _markOffline(e);
      // Offline: filter the bundled data locally so search still works.
      final q = search.trim().toLowerCase();
      wardrobe = MockData.wardrobe.where((item) {
        final matchesFilter = category == 'All' || item.category == category;
        final matchesQuery = q.isEmpty ||
            item.name.toLowerCase().contains(q) ||
            item.color.toLowerCase().contains(q) ||
            item.style.toLowerCase().contains(q);
        return matchesFilter && matchesQuery;
      }).toList();
    } finally {
      wardrobeLoading = false;
      notifyListeners();
    }
  }

  /// Runs AI analysis (§8.4) then saves the garment (§8.3).
  Future<ClothingItem?> analyzeAndAdd({
    required String name,
    String filename = 'upload.jpg',
    String image = 'assets/images/item_tee_white.jpg',
  }) async {
    try {
      final analysis = await api.analyzeClothing({
        'filename': filename,
        'name': name,
      });
      final a = (analysis['analysis'] as Map?) ?? analysis;
      final created = await api.createWardrobeItem({
        'name': name,
        'image': image,
        'category': '${a['category'] ?? 'Tops'}',
        'color': '${a['color'] ?? 'White'}',
        'style': '${a['style'] ?? 'Casual'}',
        'material': '${a['material'] ?? 'Cotton'}',
        'season': '${a['season'] ?? 'All Season'}',
        'formality': '${a['formality'] ?? 'Casual'}',
        'pattern': '${a['pattern'] ?? 'Plain'}',
      });
      final item = ClothingItem.fromJson(
        Map<String, dynamic>.from((created['item'] as Map?) ?? created),
      );
      _markOnline();
      await loadWardrobe();
      return item;
    } catch (e) {
      _markOffline(e);
      return null;
    }
  }

  Future<bool> updateItem(String id, Map<String, dynamic> patch) async {
    try {
      final res = await api.updateWardrobeItem(id, patch);
      final updated = ClothingItem.fromJson(
        Map<String, dynamic>.from((res['item'] as Map?) ?? res),
      );
      final i = wardrobe.indexWhere((w) => w.id == id);
      if (i >= 0) wardrobe[i] = updated;
      _markOnline();
      notifyListeners();
      return true;
    } catch (e) {
      _markOffline(e);
      return false;
    }
  }

  Future<bool> deleteItem(String id) async {
    try {
      await api.deleteWardrobeItem(id);
      wardrobe.removeWhere((w) => w.id == id);
      _markOnline();
      notifyListeners();
      return true;
    } catch (e) {
      _markOffline(e);
      return false;
    }
  }

  Future<bool> logWear(ClothingItem item) async {
    return updateItem(item.id, {
      'timesWorn': item.timesWorn + 1,
      'lastWornLabel': 'Worn today',
    });
  }

  // -------------------------------------------------------- outfits (§8.5)
  Future<void> loadOutfits() async {
    try {
      final res = await api.outfits();
      if (res.isNotEmpty) {
        savedOutfits = [
          for (final j in res)
            Outfit.fromJson(Map<String, dynamic>.from(j as Map)),
        ];
      }
      _markOnline();
      notifyListeners();
    } catch (e) {
      _markOffline(e);
    }
  }

  /// Today's pick + live weather for Home (§8.5 + GET /weather/current).
  Future<void> loadToday({String occasion = 'casual'}) async {
    try {
      final outfits =
          await api.recommendedOutfits(occasion: occasion, count: 1);
      if (outfits.isNotEmpty) {
        todayOutfit = Outfit.fromJson(
          Map<String, dynamic>.from(outfits.first as Map),
        );
      }
      weather = await api.weather();
      _markOnline();
      notifyListeners();
    } catch (e) {
      _markOffline(e);
    }
  }

  Future<Map<String, dynamic>?> compatibility(
    List<String> itemIds, {
    String occasion = 'casual',
  }) async {
    try {
      final res = await api.compatibility(itemIds, occasion: occasion);
      _markOnline();
      return res;
    } catch (e) {
      _markOffline(e);
      return null;
    }
  }

  Future<bool> toggleFavorite(Outfit outfit) async {
    try {
      await api.toggleFavorite(outfit.id);
      _markOnline();
      await loadOutfits();
      return true;
    } catch (e) {
      _markOffline(e);
      return false;
    }
  }

  // ------------------------------------------------------- stylist (§8.4)
  Future<({String text, Outfit? outfit})> askStylist(String message) async {
    try {
      final res = await api.chat(message);
      Outfit? outfit;
      if (res['outfit'] is Map) {
        outfit =
            Outfit.fromJson(Map<String, dynamic>.from(res['outfit'] as Map));
      }
      _markOnline();
      return (text: '${res['reply'] ?? ''}', outfit: outfit);
    } catch (e) {
      _markOffline(e);
      // Offline fallback mirrors the previous canned behaviour.
      for (final entry in MockData.stylistReplies.entries) {
        if (message.toLowerCase().contains(entry.key)) {
          return (text: entry.value, outfit: null);
        }
      }
      return (text: MockData.stylistFallback, outfit: null);
    }
  }
}
