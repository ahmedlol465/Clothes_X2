import 'package:flutter/foundation.dart';
import 'package:flutter/scheduler.dart';

import '../core/api/api_client.dart';
import '../core/api/smartwardrobe_api.dart';
import 'assets.dart';
import 'backend_status.dart';
import 'controllers/account_controller.dart';
import 'controllers/discover_controller.dart';
import 'controllers/insights_controller.dart';
import 'controllers/outfits_controller.dart';
import 'controllers/planner_controller.dart';
import 'controllers/shop_controller.dart';
import 'controllers/stylist_controller.dart';
import 'controllers/wardrobe_controller.dart';
import 'models.dart';

export 'controllers/outfits_controller.dart' show SaveOutfitResult;

/// Composition root and compatibility facade for the feature controllers.
///
/// Screens keep listening to one [AppState] (and calling `AppState.instance`)
/// while the actual state lives in small controllers:
///
///   AccountController   auth, token, profile
///   WardrobeController  wardrobe CRUD, photo import
///   OutfitsController   outfits, today, weather, compatibility
///   PlannerController   weekly plan, travel packing
///   ShopController      shopping recommendations
///   StylistController   chat, streaming, matching, style DNA
///
/// New code should depend on the specific controller it needs. The forwarding
/// members exist so the existing screens did not have to change in the same
/// refactor; they can be removed incrementally.
class AppState extends ChangeNotifier {
  AppState._() {
    _status = BackendStatus();
    final client = ApiClient();
    api = SmartWardrobeApi(client);
    _account = AccountController(client: client, api: api, status: _status);
    _wardrobe = WardrobeController(api: api, status: _status);
    _outfits = OutfitsController(api: api, status: _status);
    _planner = PlannerController(api: api, status: _status);
    _shop = ShopController(api: api, status: _status);
    _stylist = StylistController(api: api, status: _status);
    _discover = DiscoverController(api: api, status: _status);
    _insights = InsightsController(api: api, status: _status);

    _account.onSessionCleared = _resetUserScopedState;

    for (final listenable in <ChangeNotifier>[
      _status,
      _account,
      _wardrobe,
      _outfits,
      _planner,
      _shop,
      _stylist,
      _discover,
      _insights,
    ]) {
      listenable.addListener(notifyListeners);
    }
  }

  static final AppState instance = AppState._();

  late final SmartWardrobeApi api;
  late final BackendStatus _status;
  late final AccountController _account;
  late final WardrobeController _wardrobe;
  late final OutfitsController _outfits;
  late final PlannerController _planner;
  late final ShopController _shop;
  late final StylistController _stylist;
  late final DiscoverController _discover;
  late final InsightsController _insights;

  // Public getters for dependency injection in screens
  AccountController get accountController => _account;
  WardrobeController get wardrobeController => _wardrobe;
  OutfitsController get outfitsController => _outfits;
  PlannerController get plannerController => _planner;
  ShopController get shopController => _shop;
  StylistController get stylistController => _stylist;
  DiscoverController get discoverController => _discover;
  InsightsController get insightsController => _insights;
  BackendStatus get backendStatus => _status;

  /// Defer notifications that happen during build.
  ///
  /// Screens call `load*()` from `initState`, which runs while the framework is
  /// building. A synchronous [notifyListeners] would throw
  /// "setState() called during build"; deferring to the next frame keeps the
  /// same listener contract without masking the call site.
  @override
  void notifyListeners() {
    final phase = SchedulerBinding.instance.schedulerPhase;
    final building = phase == SchedulerPhase.persistentCallbacks ||
        phase == SchedulerPhase.midFrameMicrotasks;
    if (!building) {
      super.notifyListeners();
      return;
    }
    SchedulerBinding.instance.addPostFrameCallback((_) {
      if (hasListeners) super.notifyListeners();
    });
  }

  // ------------------------------------------------------------ connectivity
  bool get backendOnline => _status.online;
  String? get lastError => _status.lastError;

  // ---------------------------------------------------------------- account
  UserProfile? get profile => _account.profile;
  bool get isAuthenticated => _account.isAuthenticated;
  bool get authChecked => _account.authChecked;
  bool get authRestoring => _account.authRestoring;
  bool get profileLoading => _account.profileLoading;
  String? get profileError => _account.profileError;
  bool get profileSettled => _account.profileSettled;
  bool get avatarUploading => _account.avatarUploading;

  Future<bool> restoreSession() => _account.restoreSession();
  Future<bool> login(String email, String password) =>
      _account.login(email, password);
  Future<bool> register(String name, String email, String password) =>
      _account.register(name, email, password);
  Future<void> logout() => _account.logout();
  Future<bool> loadProfile() => _account.loadProfile();
  Future<UserProfile?> saveStyleProfile(UserProfile draft) =>
      _account.saveStyleProfile(draft);
  Future<UserProfile?> updateName(String name) => _account.updateName(name);
  Future<UserProfile?> uploadAvatar({
    required String filename,
    required List<int> bytes,
    required String mimeType,
  }) =>
      _account.uploadAvatar(
        filename: filename,
        bytes: bytes,
        mimeType: mimeType,
      );

  // --------------------------------------------------------------- wardrobe
  bool get wardrobeLoading => _wardrobe.loading;
  List<ClothingItem> get wardrobe => _wardrobe.items;
  set wardrobe(List<ClothingItem> value) => _wardrobe.items = value;
  List<String> get wardrobeFilters => _wardrobe.filters;
  set wardrobeFilters(List<String> value) => _wardrobe.filters = value;

  Future<void> loadWardrobe({String search = '', String category = 'All'}) =>
      _wardrobe.load(search: search, category: category);
  Future<({String url, Map<String, dynamic> analysis, String source})>
      stagePhoto({
    required String filename,
    required List<int> bytes,
    required String mimeType,
  }) =>
          _wardrobe.stagePhoto(
            filename: filename,
            bytes: bytes,
            mimeType: mimeType,
          );
  Future<ClothingItem> addItem(Map<String, dynamic> item) =>
      _wardrobe.addItem(item);
  Future<List<ClothingItem>> importPhotos(
    List<({String filename, List<int> bytes, String mimeType})> photos, {
    void Function(int done, int total, String stage)? onProgress,
  }) =>
      _wardrobe.importPhotos(photos, onProgress: onProgress);
  Future<ClothingItem?> analyzeAndAdd({
    required String name,
    String filename = 'upload.jpg',
    String image = Img.teeWhite,
  }) =>
      _wardrobe.analyzeAndAdd(
        name: name,
        filename: filename,
        image: image,
      );
  Future<bool> updateItem(String id, Map<String, dynamic> patch) =>
      _wardrobe.update(id, patch);
  Future<bool> deleteItem(String id) => _wardrobe.delete(id);
  Future<bool> logWear(ClothingItem item) => _wardrobe.logWear(item);

  // ---------------------------------------------------------------- outfits
  List<Outfit> get savedOutfits => _outfits.saved;
  Outfit? get todayOutfit => _outfits.today;
  Map<String, dynamic>? get weather => _outfits.weather;

  Future<void> loadOutfits() => _outfits.loadSaved();
  Future<void> loadToday({String occasion = 'casual'}) =>
      _outfits.loadToday(occasion: occasion);
  Future<Map<String, dynamic>?> compatibility(
    List<String> itemIds, {
    String occasion = 'casual',
  }) =>
      _outfits.compatibility(itemIds, occasion: occasion);
  static bool sameOutfit(Outfit a, Outfit b) =>
      OutfitsController.sameOutfit(a, b);

  Future<SaveOutfitResult> createOutfit({
    required String name,
    required List<String> itemIds,
    String occasion = 'Casual',
  }) =>
      _outfits.createOutfit(name: name, itemIds: itemIds, occasion: occasion);

  Outfit? findSavedOutfit(Outfit candidate) => _outfits.findSaved(candidate);
  Future<bool?> toggleSavedOutfit({
    required String name,
    required List<String> itemIds,
    String occasion = 'Casual',
  }) =>
      _outfits.toggleSaved(name: name, itemIds: itemIds, occasion: occasion);
  Future<bool?> toggleFavoriteOutfit({
    required String name,
    required List<String> itemIds,
    String occasion = 'Casual',
  }) =>
      _outfits.toggleFavoriteFor(
          name: name, itemIds: itemIds, occasion: occasion);

  Future<bool> toggleFavorite(Outfit outfit) => _outfits.toggleFavorite(outfit);
  Future<bool> outfitFeedback(Outfit outfit, {int rating = 5}) =>
      _outfits.feedback(outfit, rating: rating);
  Future<Outfit?> remixOutfit(List<String> itemIds, String variant) =>
      _outfits.remix(itemIds, variant);

  // ---------------------------------------------------------------- planner
  List<Map<String, dynamic>> get planWeek => _planner.week;
  List<Map<String, dynamic>> get events => _planner.events;
  List<PackingEntry> get packingItems => _planner.packing;
  String get packingMessage => _planner.packingMessage;

  Future<void> loadEvents() => _planner.loadEvents();
  Future<void> loadWeeklyPlan() => _planner.loadWeek();
  Future<void> loadPacking({
    String destination = 'Istanbul',
    int days = 7,
  }) =>
      _planner.loadPacking(destination: destination, days: days);

  // ------------------------------------------------------------------- shop
  List<ShoppingPick> get shopPicks => _shop.picks;
  Future<void> loadShop() => _shop.load();

  // --------------------------------------------------------------- discover
  bool get discoverLoading => _discover.loading;
  DiscoverContent get discoverContent => _discover.content;
  Future<void> loadDiscover() => _discover.load();

  // --------------------------------------------------------------- insights
  bool get styleDnaLoading => _insights.loading;
  StyleDna get styleDna => _insights.styleDna;
  Future<void> loadStyleDnaInsights() => _insights.loadStyleDna();

  // ---------------------------------------------------------------- stylist
  String? get conversationId => _stylist.conversationId;
  String? get styleDnaSummary => _stylist.styleDnaSummary;
  double get styleDnaConfidence => _stylist.styleDnaConfidence;

  void resetConversation() => _stylist.resetConversation();
  List<Map<String, dynamic>> chatHistory({int limit = 12}) =>
      _stylist.chatHistory(limit: limit);
  Future<({String text, Outfit? outfit})> askStylist(
    String message, {
    bool useHistory = true,
  }) =>
      _stylist.ask(message, useHistory: useHistory);
  Future<
      ({
        String text,
        Outfit? outfit,
        String source,
        Map<String, dynamic>? outfitRaw,
        String? followUp,
        List<String> suggestions,
      })>
      streamStylist(
    String message, {
    required void Function(String partial) onDelta,
  }) =>
      _stylist.stream(message, onDelta: onDelta);
  Future<OutfitMatch?> matchOutfitPhoto({
    List<int>? bytes,
    String? dataUrl,
    String mimeType = 'image/jpeg',
    String filename = 'reference.jpg',
    String note = '',
  }) =>
      _stylist.matchPhoto(
        bytes: bytes,
        dataUrl: dataUrl,
        mimeType: mimeType,
        filename: filename,
        note: note,
      );
  Future<void> loadStyleDna() => _stylist.loadStyleDna();

  // --------------------------------------------------------------- internal
  void _resetUserScopedState() {
    _wardrobe.reset();
    _outfits.reset();
    _planner.reset();
    _shop.reset();
    _stylist.reset();
    _discover.reset();
    _insights.reset();
    notifyListeners();
  }
}
