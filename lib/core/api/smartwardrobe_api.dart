import 'api_client.dart';
import 'api_config.dart';
import 'dart:convert';

/// Typed wrapper over every backend module (§8 API Overview).
/// Auth token is held by the underlying [ApiClient].
class SmartWardrobeApi {
  SmartWardrobeApi(this._client);

  final ApiClient _client;

  // ------------------------------------------------------------ 8.1 Auth
  Future<Map<String, dynamic>> register(
    String name,
    String email,
    String password,
  ) async {
    final res = await _client.post('/auth/register', {
      'name': name,
      'email': email,
      'password': password,
    });
    _client.setToken(res['accessToken'] as String?);
    return Map<String, dynamic>.from(res as Map);
  }

  Future<Map<String, dynamic>> login(String email, String password) async {
    final res = await _client.post('/auth/login', {
      'email': email,
      'password': password,
    });
    _client.setToken(res['accessToken'] as String?);
    return Map<String, dynamic>.from(res as Map);
  }

  /// Public: whether the server has a Google Client ID configured, and its
  /// value (the web sign-in flow needs it in the page, so it is not secret).
  Future<Map<String, dynamic>> googleClientStatus() async =>
      Map<String, dynamic>.from(await _client.get('/auth/google/config'));

  /// Google sign-in: exchange a verified Google ID token for a session.
  Future<Map<String, dynamic>> loginWithGoogle(String idToken) async {
    final res = await _client.post('/auth/google', {'idToken': idToken});
    _client.setToken(res['accessToken'] as String?);
    return Map<String, dynamic>.from(res as Map);
  }

  Future<void> logout() async {
    try {
      await _client.post('/auth/logout');
    } finally {
      _client.clearToken();
    }
  }

  // ----------------------------------------------------------- 8.2 Users
  /// Raw `/users/me` wrapper: `{ user: {...} }`.
  Future<Map<String, dynamic>> me() async =>
      Map<String, dynamic>.from(await _client.get('/users/me'));

  /// The authenticated user, unwrapped from the `{ user }` envelope.
  ///
  /// Throws [ApiException] with status 401 when the token is missing or was
  /// invalidated by a logout, which is how the app detects a dead session.
  Future<Map<String, dynamic>> currentUser() async {
    final res = await me();
    final user = res['user'];
    if (user is! Map) {
      throw ApiException('Malformed user payload.', status: 500);
    }
    return Map<String, dynamic>.from(user);
  }

  /// Account fields a client may change (name). The avatar is no longer
  /// settable here: it must go through [uploadAvatar] so the bytes actually
  /// live on the server. Email is read-only.
  Future<Map<String, dynamic>> updateMe(Map<String, dynamic> patch) async {
    final res = await _client.patch('/users/me', patch);
    return Map<String, dynamic>.from((res as Map)['user'] as Map);
  }

  /// Uploads a profile picture and returns the updated user, including the
  /// freshly stored `avatarUrl`.
  ///
  /// The backend derives the account from the bearer token, so there is no
  /// user id to pass and none that could be spoofed.
  Future<Map<String, dynamic>> uploadAvatar({
    required String filename,
    required List<int> bytes,
    required String mimeType,
  }) async {
    final res = await _client.uploadPhotos(
      '/users/me/avatar',
      [(filename: filename, bytes: bytes, mimeType: mimeType)],
      field: 'photo',
    );
    if (res is! Map || res['user'] is! Map) {
      throw ApiException('Malformed upload response.', status: 500);
    }
    return Map<String, dynamic>.from(res['user'] as Map);
  }

  /// The style blueprint shown on the Profile page.
  Future<Map<String, dynamic>> styleProfile() async {
    final res = await _client.get('/users/me/style-profile');
    return Map<String, dynamic>.from((res as Map)['styleProfile'] as Map);
  }

  /// Persists the style blueprint and returns the saved values echoed by the
  /// backend, so the UI renders what was actually stored rather than what was
  /// optimistically typed.
  Future<Map<String, dynamic>> updateStyleProfile(
    Map<String, dynamic> styleProfile,
  ) async {
    final res = await _client.patch('/users/me/style-profile', styleProfile);
    return Map<String, dynamic>.from((res as Map)['styleProfile'] as Map);
  }

  // -------------------------------------------------------- 8.3 Wardrobe
  Future<Map<String, dynamic>> wardrobeItems({
    String search = '',
    String category = 'All',
    String sort = 'recent',
  }) async =>
      Map<String, dynamic>.from(
        await _client.get('/wardrobe/items', {
          'search': search,
          'category': category,
          'sort': sort,
        }),
      );

  Future<Map<String, dynamic>> createWardrobeItem(
    Map<String, dynamic> item,
  ) async =>
      Map<String, dynamic>.from(await _client.post('/wardrobe/items', item));

  Future<Map<String, dynamic>> updateWardrobeItem(
    String id,
    Map<String, dynamic> patch,
  ) async =>
      Map<String, dynamic>.from(
        await _client.patch('/wardrobe/items/$id', patch),
      );

  Future<void> deleteWardrobeItem(String id) async {
    await _client.delete('/wardrobe/items/$id');
  }

  /// Uploads device photos (§8.3). Each entry is (filename, bytes, mimeType).
  /// Returns the stored file list [{url, filename, mime, size}].
  Future<List<Map<String, dynamic>>> uploadWardrobePhotos(
    List<({String filename, List<int> bytes, String mimeType})> photos,
  ) async {
    final res = await _client.uploadPhotos('/wardrobe/upload', photos);
    final files = (res as Map)['files'] as List? ?? const [];
    return [
      for (final f in files) Map<String, dynamic>.from(f as Map),
    ];
  }

  // ------------------------------------------------------------- 8.4 AI
  Future<Map<String, dynamic>> analyzeClothing(
    Map<String, dynamic> input,
  ) async {
    final res = await _client.post(
      '/ai/analyze-clothing',
      input,
      ApiConfig.analyzeTimeout,
    );
    return Map<String, dynamic>.from(res);
  }

  /// Analysis of a real photo: pass the stored [imageUrl] from
  /// [uploadWardrobePhotos] (server reads the pixels off disk for vision),
  /// or raw [imageBytes] which are sent as a data URL.
  Future<Map<String, dynamic>> analyzePhoto({
    String? imageUrl,
    List<int>? imageBytes,
    String mimeType = 'image/jpeg',
    String filename = 'photo.jpg',
    String name = '',
  }) async {
    final Map<String, dynamic> body = {
      'filename': filename,
      if (name.isNotEmpty) 'name': name,
    };
    if (imageUrl != null) {
      body['imageUrl'] = imageUrl;
    } else if (imageBytes != null) {
      body['imageBase64'] = base64Encode(imageBytes);
      body['mime'] = mimeType;
    }
    return analyzeClothing(body);
  }

  Future<List<dynamic>> generateOutfit({
    String occasion = 'casual',
    double tempC = 24,
    int count = 3,
    String? anchorItemId,
  }) async {
    final Map<String, dynamic> body = {
      'occasion': occasion,
      'weather': {'tempC': tempC},
      'count': count,
    };
    if (anchorItemId != null) body['anchorItemId'] = anchorItemId;
    final res = await _client.postAi('/ai/generate-outfit', body);
    return List<dynamic>.from((res as Map)['outfits'] as List);
  }

  Future<Map<String, dynamic>> compatibility(
    List<String> itemIds, {
    String occasion = 'casual',
    double tempC = 24,
  }) async =>
      Map<String, dynamic>.from(
        await _client.post('/ai/calculate-compatibility', {
          'itemIds': itemIds,
          'occasion': occasion,
          'weather': {'tempC': tempC},
        }),
      );

  /// The stylist turn (`POST /ai/chat`).
  ///
  /// [history] is the already-sent turns as `{fromUser: bool, text: String}`.
  /// When empty the server recalls its own log for [conversationId], so the
  /// conversation survives a client restart either way.
  Future<Map<String, dynamic>> chat(
    String message, {
    List<Map<String, dynamic>> history = const [],
    String? conversationId,
    String? language,
  }) async =>
      Map<String, dynamic>.from(
        await _client.postAi('/ai/chat', {
          'message': message,
          'history': history,
          'conversationId': ?conversationId,
          'language': ?language,
        }),
      );

  /// Streaming variant (`POST /ai/chat/stream`): `delta` events carry text
  /// fragments, `done` carries the assembled turn. The server still answers
  /// with the rule engine when no LLM key is configured, so this never hangs.
  Stream<({String event, Map<String, dynamic> data})> chatStream(
    String message, {
    List<Map<String, dynamic>> history = const [],
    String? conversationId,
    String? language,
  }) =>
      _client.streamPost('/ai/chat/stream', {
        'message': message,
        'history': history,
        'conversationId': ?conversationId,
        'language': ?language,
      });

  /// Match a photo of an outfit someone else wears against the user's own
  /// wardrobe (`POST /ai/match-outfit`). Pass [imageBytes] (raw photo) or
  /// [dataUrl]; [filename] is used as the no-key fallback signal.
  Future<Map<String, dynamic>> matchOutfit({
    List<int>? imageBytes,
    String? dataUrl,
    String mimeType = 'image/jpeg',
    String filename = 'reference.jpg',
    String note = '',
  }) async {
    final Map<String, dynamic> body = {'filename': filename};
    if (note.isNotEmpty) body['note'] = note;
    if (dataUrl != null) {
      body['dataUrl'] = dataUrl;
    } else if (imageBytes != null) {
      body['dataUrl'] = 'data:$mimeType;base64,${base64Encode(imageBytes)}';
    }
    return Map<String, dynamic>.from(
      await _client.postAi('/ai/match-outfit', body),
    );
  }

  /// Re-dress an outfit for another context (`POST /ai/remix`).
  /// [variant] is one of casual | cold | summer | date | formal.
  Future<Map<String, dynamic>> remix(
    List<String> itemIds,
    String variant, {
    double? tempC,
  }) async =>
      Map<String, dynamic>.from(
        await _client.post('/ai/remix', {
          'itemIds': itemIds,
          'variant': variant,
          if (tempC != null)
            'weather': {'tempC': tempC, 'condition': tempC >= 26 ? 'sunny' : 'partly cloudy'},
        }),
      );

  /// What the stylist has learned about this user (`GET /ai/style-dna`).
  Future<Map<String, dynamic>> styleDna() async =>
      Map<String, dynamic>.from(await _client.get('/ai/style-dna'));

  /// DB-backed style breakdown used by the Style DNA tab
  /// (`GET /insights/style-dna`).
  Future<Map<String, dynamic>> styleDnaInsights() async =>
      Map<String, dynamic>.from(await _client.get('/insights/style-dna'));

  /// Editorial content for the Discover tab (`GET /content/discover`).
  Future<Map<String, dynamic>> discoverContent() async =>
      Map<String, dynamic>.from(await _client.get('/content/discover'));

  /// Recent stylist turns, oldest first (`GET /ai/conversations`).
  Future<List<Map<String, dynamic>>> conversations({int limit = 40}) async {
    final res = await _client.get('/ai/conversations', {'limit': '$limit'});
    return [
      for (final t in (res as Map)['turns'] as List? ?? const [])
        Map<String, dynamic>.from(t as Map),
    ];
  }

  /// Forget the conversation, keep the learned taste
  /// (`DELETE /ai/conversations`).
  Future<void> clearConversations() async {
    await _client.delete('/ai/conversations');
  }

  /// What the stylist can currently do, and how to enable the rest
  /// (`GET /ai/capabilities`).
  Future<Map<String, dynamic>> capabilities() async =>
      Map<String, dynamic>.from(await _client.get('/ai/capabilities'));

  Future<Map<String, dynamic>> wardrobeGap() async =>
      Map<String, dynamic>.from(await _client.post('/ai/wardrobe-gap'));

  Future<Map<String, dynamic>> packingList({
    String destination = 'Trip',
    int days = 5,
  }) async =>
      Map<String, dynamic>.from(
        await _client.post('/ai/packing-list', {
          'destination': destination,
          'days': days,
        }),
      );

  // ---------------------------------------------------------- 8.5 Outfits
  Future<List<dynamic>> recommendedOutfits({
    String occasion = 'casual',
    double tempC = 24,
    int count = 3,
  }) async {
    final res = await _client.get('/outfits/recommended', {
      'occasion': occasion,
      'tempC': '$tempC',
      'count': '$count',
    });
    return List<dynamic>.from((res as Map)['outfits'] as List);
  }

  Future<Map<String, dynamic>> createOutfit(
    String name,
    List<String> itemIds, {
    String occasion = 'Casual',
  }) async =>
      Map<String, dynamic>.from(
        await _client.post('/outfits', {
          'name': name,
          'itemIds': itemIds,
          'occasion': occasion,
        }),
      );

  Future<Map<String, dynamic>> toggleFavorite(String outfitId) async =>
      Map<String, dynamic>.from(
        await _client.post('/outfits/$outfitId/favorite'),
      );

  Future<void> outfitFeedback(
    String outfitId, {
    int rating = 5,
    String comment = '',
  }) async {
    await _client.post('/outfits/$outfitId/feedback', {
      'rating': rating,
      'comment': comment,
    });
  }

  Future<List<dynamic>> outfits({bool? favorite}) async {
    final res = await _client.get(
      '/outfits',
      favorite == null ? null : {'favorite': '$favorite'},
    );
    return List<dynamic>.from((res as Map)['outfits'] as List);
  }

  // ---------------------------------------------------------- 8.6 Planner
  Future<List<dynamic>> events() async =>
      List<dynamic>.from((await _client.get('/events') as Map)['events']);

  Future<List<dynamic>> weeklyPlan() async => List<dynamic>.from(
    (await _client.get('/planner/weekly') as Map)['week'],
  );

  Future<Map<String, dynamic>> regenerateWeeklyPlan({
    String occasion = 'casual',
  }) async =>
      Map<String, dynamic>.from(
        await _client.post('/planner/weekly', {'occasion': occasion}),
      );

  Future<Map<String, dynamic>> travelPacking({
    String destination = 'Trip',
    int days = 5,
  }) =>
      packingList(destination: destination, days: days);

  // --------------------------------------------------------- 8.7 Shopping
  Future<Map<String, dynamic>> shopRecommended() async =>
      Map<String, dynamic>.from(await _client.get('/shop/recommended'));

  /// Budget outfit builder (`POST /shop/outfit-builder`): the server picks
  /// the best-value in-stock set that fits [budget].
  Future<Map<String, dynamic>> buildOutfitWithinBudget(
    double budget, {
    String occasion = 'casual',
  }) async =>
      Map<String, dynamic>.from(
        await _client.post('/shop/outfit-builder', {
          'budget': budget,
          'occasion': occasion,
        }),
      );

  Future<void> addToWishlist(Map<String, dynamic> entry) async {
    await _client.post('/shop/wishlist', entry);
  }

  /// "Before you buy" check (`POST /shop/before-you-buy`): how well a
  /// candidate product matches what the user already owns.
  Future<Map<String, dynamic>> beforeYouBuy(
    Map<String, dynamic> product,
  ) async =>
      Map<String, dynamic>.from(
        await _client.post('/shop/before-you-buy', product),
      );

  // ------------------------------------------------------------ misc
  /// Live weather. Pass phone GPS [lat]/[lon] to report where the user
  /// actually stands (the backend reverse-geocodes the city name then);
  /// otherwise a [city] name is geocoded server-side. Omit both and the
  /// backend defaults to Cairo.
  ///
  /// Unwraps the Express `{weather: …}` envelope so callers always see the
  /// weather object itself — reading `summary` off the raw envelope is what
  /// used to pin the Home pill to its fallback text.
  ///
  /// [city] is only sent when explicitly provided: always sending the
  /// `'Cairo'` default alongside GPS coordinates made the backend prefer the
  /// hint over the reverse-geocoded name, so every user saw "Cairo" no matter
  /// where they stood.
  Future<Map<String, dynamic>> weather({
    String? city,
    double? lat,
    double? lon,
  }) async {
    final query = <String, String>{};
    if (city != null && city.trim().isNotEmpty) {
      query['city'] = city.trim();
    }
    if (lat != null && lon != null) {
      query['lat'] = '$lat';
      query['lon'] = '$lon';
    }
    final res = Map<String, dynamic>.from(
      await _client.get('/weather/current', query),
    );
    final inner = res['weather'];
    if (inner is Map) return Map<String, dynamic>.from(inner);
    return res;
  }

  Future<bool> ping() async {
    try {
      final res = await _client.get('/health');
      return (res as Map)['status'] == 'ok';
    } catch (_) {
      return false;
    }
  }
}
