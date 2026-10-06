import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

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
  //
  // The bearer token lives on [ApiClient] in memory, and is mirrored into
  // SharedPreferences so a cold start can restore the session. Only the token
  // is cached — every profile field is read from the backend on demand, so a
  // stale cache can never be mistaken for real data.

  static const String _tokenKey = 'sw.authToken';

  SharedPreferences? _prefs;

  /// True once the stored session has been checked (or confirmed absent) on
  /// startup. The splash screen waits for this before routing.
  bool authChecked = false;

  /// True while a session restore is in flight.
  bool authRestoring = false;

  /// The signed-in user, or null when signed out. Mirrors the backend
  /// `/users/me` payload; never a locally invented object.
  UserProfile? _profile;
  UserProfile? get profile => _profile;

  bool get isAuthenticated => _profile != null;

  /// Profile fetch state, used by the Profile screen for its loading and error
  /// states. [profileError] is only ever set from a real API failure.
  bool profileLoading = false;
  String? profileError;

  /// True once a `loadProfile` attempt has settled, successfully or not.
  ///
  /// Distinguishes "the request failed" from "nothing has been requested yet",
  /// so the very first frame renders the skeleton instead of an error card.
  bool profileSettled = false;

  /// True while a profile picture is being uploaded, so the avatar can show a
  /// spinner and the UI cannot claim a save that has not been confirmed.
  bool avatarUploading = false;

  /// Restores a stored token on startup and validates it against
  /// `GET /users/me`. A rejected token is discarded so the app falls back to
  /// the login screen rather than showing a broken profile.
  Future<bool> restoreSession() async {
    _prefs ??= await SharedPreferences.getInstance();
    authRestoring = true;
    notifyListeners();
    try {
      final token = _prefs?.getString(_tokenKey);
      if (token == null || token.isEmpty) {
        _profile = null;
        _client.clearToken();
        return false;
      }
      _client.setToken(token);
      final user = await api.currentUser();
      _profile = UserProfile.fromJson(user);
      _markOnline();
      return true;
    } on ApiException catch (e) {
      // 401/403 means the server dropped the session (logged out elsewhere,
      // or the session was invalidated). Anything else is a network problem:
      // keep the token so the next launch can retry.
      if (e.status == 401 || e.status == 403) {
        _profile = null;
        _client.clearToken();
        await _prefs?.remove(_tokenKey);
      }
      _markOffline(e);
      return false;
    } finally {
      authRestoring = false;
      authChecked = true;
      notifyListeners();
    }
  }

  Future<void> _persistToken(String token) async {
    _prefs ??= await SharedPreferences.getInstance();
    await _prefs?.setString(_tokenKey, token);
  }

  Future<bool> login(String email, String password) async {
    try {
      final res = await api.login(email, password);
      final user = res['user'];
      if (user is Map) _profile = UserProfile.fromJson(user.cast<String, dynamic>());
      await _persistToken('${res['accessToken'] ?? ''}');
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
      final user = res['user'];
      if (user is Map) _profile = UserProfile.fromJson(user.cast<String, dynamic>());
      await _persistToken('${res['accessToken'] ?? ''}');
      _markOnline();
      notifyListeners();
      return true;
    } catch (e) {
      _markOffline(e);
      return false;
    }
  }

  /// Clears the session locally and server-side, then drops every user-scoped
  /// cache so nothing from the previous account can leak into the next one.
  Future<void> logout() async {
    try {
      await api.logout();
    } catch (_) {
      // Even if the revoke call fails the local session must still be dropped,
      // otherwise the user is stuck in an authenticated shell.
    }
    _client.clearToken();
    await _prefs?.remove(_tokenKey);
    _profile = null;
    profileError = null;
    profileLoading = false;
    profileSettled = false;
    avatarUploading = false;
    _resetUserScopedState();
    notifyListeners();
  }

  /// Everything cached per user. Cleared on logout so the next account never
  /// sees the previous account's wardrobe, outfits or learned style.
  void _resetUserScopedState() {
    wardrobe = [...MockData.wardrobe];
    savedOutfits = [...MockData.savedOutfits];
    todayOutfit = MockData.todaySelection;
    weather = null;
    shopPicks = [...MockData.shoppingPicks];
    styleDnaSummary = null;
    styleDnaConfidence = 0;
    _conversationId = null;
    _chatHistory.clear();
    resetConversation();
  }

  // ------------------------------------------------------- profile (§8.2)

  /// Fetches the authenticated profile from the backend. Never falls back to
  /// mock data: on failure the error is surfaced so the UI can show a retry.
  Future<bool> loadProfile() async {
    if (_profile == null && !_client.hasToken) {
      profileError = 'You are not signed in.';
      profileSettled = true;
      notifyListeners();
      return false;
    }
    profileLoading = true;
    profileError = null;
    notifyListeners();
    try {
      final user = await api.currentUser();
      _profile = UserProfile.fromJson(user);
      _markOnline();
      profileLoading = false;
      profileSettled = true;
      notifyListeners();
      return true;
    } on ApiException catch (e) {
      profileLoading = false;
      profileSettled = true;
      profileError = e.status == 401 || e.status == 403
          ? 'Your session has expired. Please sign in again.'
          : e.message;
      if (e.status == 401 || e.status == 403) {
        _profile = null;
        _client.clearToken();
        unawaited(_prefs?.remove(_tokenKey));
      }
      notifyListeners();
      return false;
    } catch (e) {
      profileLoading = false;
      profileSettled = true;
      profileError = e.toString();
      notifyListeners();
      return false;
    }
  }

  /// Saves the style profile to the backend and adopts the values it echoes
  /// back, so the UI can only ever display what the database actually stored.
  /// Returns the saved profile, or null when the save failed — callers must
  /// treat null as "nothing was saved".
  Future<UserProfile?> saveStyleProfile(UserProfile draft) async {
    try {
      final saved = await api.updateStyleProfile(draft.toStyleProfileJson());
      // Re-read the whole user so name/email/createdAt stay authoritative and
      // the saved style fields come from the server, not from the draft.
      final user = await api.currentUser();
      _profile = UserProfile.fromJson({
        ...user,
        'styleProfile': {
          ...(user['styleProfile'] as Map? ?? const {}),
          ...saved,
        },
      });
      _markOnline();
      notifyListeners();
      return _profile;
    } on ApiException catch (e) {
      if (e.status == 401 || e.status == 403) {
        _profile = null;
        _client.clearToken();
        unawaited(_prefs?.remove(_tokenKey));
      }
      _markOffline(e);
      return null;
    }
  }

  /// Updates the account name through `PATCH /users/me`. Email is not
  /// editable here — changing it needs a verification flow that does not
  /// exist yet.
  Future<UserProfile?> updateName(String name) async {
    final trimmed = name.trim();
    if (trimmed.isEmpty) return null;
    try {
      final user = await api.updateMe({'name': trimmed});
      _profile = _profile == null
          ? UserProfile.fromJson(user)
          : _profile!.copyWith(
              name: '${user['name'] ?? trimmed}',
              avatarUrl: '${user['avatarUrl'] ?? ''}'.isEmpty
                  ? null
                  : '${user['avatarUrl']}',
            );
      _markOnline();
      notifyListeners();
      return _profile;
    } on ApiException catch (e) {
      _markOffline(e);
      return null;
    }
  }

  /// Uploads a new profile picture and adopts the URL the backend stored.
  ///
  /// Returns the refreshed profile on success, or null on failure — the caller
  /// must not treat a null result as a saved image. The local profile is only
  /// replaced with the server's response, so what the UI shows is what was
  /// actually persisted, and a 401 mid-upload clears the session rather than
  /// leaving a local-only image behind.
  Future<UserProfile?> uploadAvatar({
    required String filename,
    required List<int> bytes,
    required String mimeType,
  }) async {
    avatarUploading = true;
    notifyListeners();
    try {
      final user = await api.uploadAvatar(
        filename: filename,
        bytes: bytes,
        mimeType: mimeType,
      );
      _profile = UserProfile.fromJson(user);
      _markOnline();
      avatarUploading = false;
      notifyListeners();
      return _profile;
    } on ApiException catch (e) {
      avatarUploading = false;
      if (e.status == 401 || e.status == 403) {
        _profile = null;
        _client.clearToken();
        unawaited(_prefs?.remove(_tokenKey));
      }
      _markOffline(e);
      notifyListeners();
      return null;
    } catch (e) {
      avatarUploading = false;
      _markOffline(e);
      notifyListeners();
      return null;
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

  /// Stages one picked photo: uploads bytes, then runs vision analysis on
  /// the stored pixels. Returns the public URL + analysis + source.
  /// Used by Add Clothes so tags are real before the user hits Save.
  Future<({String url, Map<String, dynamic> analysis, String source})>
      stagePhoto({
    required String filename,
    required List<int> bytes,
    required String mimeType,
  }) async {
    final stored = await api.uploadWardrobePhotos(
      [(filename: filename, bytes: bytes, mimeType: mimeType)],
    );
    final url = '${stored.first['url'] ?? ''}';
    try {
      final res = await api.analyzePhoto(imageUrl: url, filename: filename);
      return (
        url: url,
        analysis: Map<String, dynamic>.from(
          (res['analysis'] as Map?) ?? const {},
        ),
        source: '${res['source'] ?? 'heuristic'}',
      );
    } on ApiException catch (e) {
      if (e.status != null) {
        // The backend looked at the pixels and answered with an error status.
        // A rejection (422) or a server failure must never be wrapped in
        // default garment tags — the Add Clothes screen surfaces it instead.
        if (e.status == 422) {
          throw ApiException(_notClothingMessage, status: 422);
        }
        rethrow;
      }
      // Unreachable backend → documented offline heuristics.
      return (url: url, analysis: <String, dynamic>{}, source: 'heuristic');
    } catch (_) {
      return (url: url, analysis: <String, dynamic>{}, source: 'heuristic');
    }
  }

  /// Saves one garment with explicit attributes (Add Clothes confirmation).
  Future<ClothingItem> addItem(Map<String, dynamic> item) async {
    final res = await api.createWardrobeItem(item);
    final created = ClothingItem.fromJson(
      Map<String, dynamic>.from((res['item'] as Map?) ?? res),
    );
    _markOnline();
    await loadWardrobe();
    return created;
  }

  /// Real photo import: uploads bytes (§8.3), runs vision analysis on the
  /// actual pixels (§8.4), then saves each garment. Reports progress as
  /// (done, total, stage) where stage is 'upload', 'analyze' or 'save'.
  /// Throws [ApiException] when the backend is unreachable — no demo data.
  Future<List<ClothingItem>> importPhotos(
    List<({String filename, List<int> bytes, String mimeType})> photos, {
    void Function(int done, int total, String stage)? onProgress,
  }) async {
    final total = photos.length;
    onProgress?.call(0, total, 'upload');
    final stored = await api.uploadWardrobePhotos(photos);
    final created = <ClothingItem>[];
    for (var i = 0; i < stored.length; i++) {
      final file = stored[i];
      final url = '${file['url'] ?? ''}';
      final filename = '${file['filename'] ?? photos[i].filename}';
      onProgress?.call(i, total, 'analyze');
      Map<String, dynamic> a = const {};
      String source = 'heuristic';
      try {
        final res = await api.analyzePhoto(
          imageUrl: url,
          filename: filename,
        );
        a = (res['analysis'] as Map?)?.cast<String, dynamic>() ?? {};
        source = '${res['source'] ?? 'heuristic'}';
      } on ApiException catch (e) {
        if (e.status == 422) {
          throw ApiException(_notClothingMessage, status: 422);
        }
        if (e.status != null) rethrow;
        // Unreachable backend → keep filename heuristics below.
      } catch (_) {
        // Analyze must never block saving: fall back to filename heuristics.
      }
      onProgress?.call(i, total, 'save');
      final itemRes = await api.createWardrobeItem({
        'name': '${a['suggestedName'] ?? filename.split('.').first}',
        'image': url,
        'category': '${a['category'] ?? 'Tops'}',
        'color': '${a['color'] ?? 'White'}',
        'style': '${a['style'] ?? 'Casual'}',
        'material': '${a['material'] ?? 'Cotton'}',
        'season': '${a['season'] ?? 'All Season'}',
        'formality': '${a['formality'] ?? 'Casual'}',
        'pattern': '${a['pattern'] ?? 'Plain'}',
        'analysisSource': source,
      });
      created.add(
        ClothingItem.fromJson(
          Map<String, dynamic>.from(
            (itemRes['item'] as Map?) ?? itemRes,
          ),
        ),
      );
      onProgress?.call(i + 1, total, 'save');
    }
    _markOnline();
    await loadWardrobe();
    return created;
  }

  /// Shown when the clothing gate rejects a photo with HTTP 422 so a bottle,
  /// chair or other object is never staged as a default-tagged garment.
  static const _notClothingMessage =
      "This photo doesn't look like clothing. Tap it to retry with a garment photo.";

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
  //
  // The conversation is stateful: [askStylist] tracks a [conversationId] and
  // the turns already sent, so the backend can recall context even if the
  // client forgets to pass history.

  /// Stable id for the current conversation. Sent as `conversationId` so the
  /// server can recall previous turns for this thread.
  String? _conversationId;

  /// Turns already exchanged, oldest first, in the shape `llm.js` expects.
  final List<Map<String, dynamic>> _chatHistory = [];

  String? get conversationId => _conversationId;

  /// Human-readable one-liner of what the stylist has learned, from
  /// `GET /ai/style-dna`. Null until [loadStyleDna] succeeds.
  String? styleDnaSummary;
  double styleDnaConfidence = 0;

  /// Start a fresh thread. Learned taste is kept server-side; only the
  /// conversation is reset.
  void resetConversation() {
    _conversationId = 'c${DateTime.now().millisecondsSinceEpoch}';
    _chatHistory.clear();
  }

  /// Turns to send as `history`, capped to the last [limit] pairs so long
  /// chats do not blow the context window.
  List<Map<String, dynamic>> chatHistory({int limit = 12}) {
    if (_chatHistory.length <= limit) {
      return [for (final t in _chatHistory) Map<String, dynamic>.from(t)];
    }
    return [
      for (final t in _chatHistory.sublist(_chatHistory.length - limit))
        Map<String, dynamic>.from(t),
    ];
  }

  Future<({String text, Outfit? outfit})> askStylist(
    String message, {
    bool useHistory = true,
  }) async {
    try {
      final res = await api.chat(
        message,
        history: useHistory ? chatHistory() : const [],
        conversationId: _conversationId,
      );
      final text = '${res['reply'] ?? ''}';
      final outfit = res['outfit'] is Map
          ? Outfit.fromJson(Map<String, dynamic>.from(res['outfit'] as Map))
          : null;
      _recordTurn(message, text);
      _applyMemory(res['memory']);
      _markOnline();
      return (text: text, outfit: outfit);
    } catch (e) {
      _markOffline(e);
      // Offline fallback mirrors the previous canned behaviour.
      final text = _offlineReply(message);
      _recordTurn(message, text);
      return (text: text, outfit: null);
    }
  }

  /// Streaming stylist turn (`POST /ai/chat/stream`).
  ///
  /// [onDelta] receives text fragments as they arrive. Returns the same shape
  /// as [askStylist] once the `done` event lands. Falls back to the rule
  /// engine through the same endpoint, and to the bundled mock replies if the
  /// backend cannot be reached at all.
  Future<({String text, Outfit? outfit, String source})> streamStylist(
    String message, {
    required void Function(String partial) onDelta,
  }) async {
    try {
      var text = '';
      Map<String, dynamic>? done;
      await for (final frame in api.chatStream(
        message,
        history: chatHistory(),
        conversationId: _conversationId,
      )) {
        switch (frame.event) {
          case 'delta':
            final delta = '${frame.data['delta'] ?? ''}';
            if (delta.isEmpty) break;
            text += delta;
            onDelta(text);
          case 'error':
            // Recoverable: the server still emits `done` with a rule reply.
            break;
          case 'done':
            done = frame.data;
        }
      }
      final payload = done ?? {'reply': text};
      final finalText = '${payload['reply'] ?? text}';
      final outfit = payload['outfit'] is Map
          ? Outfit.fromJson(Map<String, dynamic>.from(payload['outfit'] as Map))
          : null;
      if (finalText.isNotEmpty && finalText != text) onDelta(finalText);
      _recordTurn(message, finalText);
      _applyMemory(payload['memory']);
      _markOnline();
      return (
        text: finalText,
        outfit: outfit,
        source: '${payload['source'] ?? 'rules'}',
      );
    } catch (e) {
      _markOffline(e);
      final text = _offlineReply(message);
      _recordTurn(message, text);
      onDelta(text);
      return (text: text, outfit: null, source: 'offline');
    }
  }

  /// Match a photographed outfit against the wardrobe
  /// (`POST /ai/match-outfit`).
  Future<OutfitMatch?> matchOutfitPhoto({
    List<int>? bytes,
    String? dataUrl,
    String mimeType = 'image/jpeg',
    String filename = 'reference.jpg',
    String note = '',
  }) async {
    try {
      final res = await api.matchOutfit(
        imageBytes: bytes,
        dataUrl: dataUrl,
        mimeType: mimeType,
        filename: filename,
        note: note,
      );
      _markOnline();
      return OutfitMatch.fromJson(res);
    } catch (e) {
      _markOffline(e);
      return null;
    }
  }

  /// Re-dress an outfit for another context (`POST /ai/remix`).
  /// Returns null when the backend is unreachable.
  Future<Outfit?> remixOutfit(List<String> itemIds, String variant) async {
    if (itemIds.isEmpty) return null;
    try {
      final res = await api.remix(itemIds, variant);
      final outfit = res['outfit'];
      _markOnline();
      return outfit is Map
          ? Outfit.fromJson(Map<String, dynamic>.from(outfit))
          : null;
    } catch (e) {
      _markOffline(e);
      return null;
    }
  }

  /// Load the learned taste summary (`GET /ai/style-dna`).
  Future<void> loadStyleDna() async {
    try {
      final res = await api.styleDna();
      final dna = res['digest'];
      _markOnline();
      if (dna is Map) {
        styleDnaSummary = _describeDna(Map<String, dynamic>.from(dna));
        styleDnaConfidence =
            ((res['styleDna'] as Map?)?['confidence'] as num?)?.toDouble() ??
                0;
        notifyListeners();
      }
    } catch (e) {
      _markOffline(e);
    }
  }

  String _describeDna(Map<String, dynamic> digest) {
    final parts = <String>[
      for (final entry in [
        ('Dislikes', digest['dislikes']),
        ('Prefers', digest['prefers']),
        ('Notes', digest['notes']),
      ])
        if (entry.$2 != null && '${entry.$2}'.trim().isNotEmpty)
          '${entry.$1}: ${entry.$2}',
    ];
    if (parts.isEmpty) return 'Still learning your taste — rate a few looks.';
    return parts.join(' · ');
  }

  void _recordTurn(String message, String reply) {
    _chatHistory.add({'fromUser': true, 'text': message});
    _chatHistory.add({'fromUser': false, 'text': reply});
    if (_chatHistory.length > 60) {
      _chatHistory.removeRange(0, _chatHistory.length - 60);
    }
  }

  void _applyMemory(Object? memory) {
    if (memory is! Map) return;
    final digest = memory['digest'];
    if (digest is Map) {
      styleDnaSummary = _describeDna(Map<String, dynamic>.from(digest));
    }
    styleDnaConfidence =
        (memory['confidence'] as num?)?.toDouble() ?? styleDnaConfidence;
  }

  String _offlineReply(String message) {
    for (final entry in MockData.stylistReplies.entries) {
      if (message.toLowerCase().contains(entry.key)) return entry.value;
    }
    return MockData.stylistFallback;
  }
}
