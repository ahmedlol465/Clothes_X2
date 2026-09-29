import 'api_client.dart';

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

  Future<void> logout() async {
    try {
      await _client.post('/auth/logout');
    } finally {
      _client.clearToken();
    }
  }

  // ----------------------------------------------------------- 8.2 Users
  Future<Map<String, dynamic>> me() async =>
      Map<String, dynamic>.from(await _client.get('/users/me'));

  Future<Map<String, dynamic>> updateMe(Map<String, dynamic> patch) async =>
      Map<String, dynamic>.from(await _client.patch('/users/me', patch));

  Future<Map<String, dynamic>> styleProfile() async => Map<String, dynamic>.from(
    await _client.get('/users/me/style-profile'),
  );

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

  // ------------------------------------------------------------- 8.4 AI
  Future<Map<String, dynamic>> analyzeClothing(
    Map<String, dynamic> input,
  ) async =>
      Map<String, dynamic>.from(
        await _client.post('/ai/analyze-clothing', input),
      );

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
    final res = await _client.post('/ai/generate-outfit', body);
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

  Future<Map<String, dynamic>> chat(
    String message, {
    List<Map<String, String>> history = const [],
  }) async =>
      Map<String, dynamic>.from(
        await _client.post('/ai/chat', {'message': message, 'history': history}),
      );

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

  Future<void> addToWishlist(Map<String, dynamic> entry) async {
    await _client.post('/shop/wishlist', entry);
  }

  // ------------------------------------------------------------ misc
  Future<Map<String, dynamic>> weather({String city = 'Cairo'}) async =>
      Map<String, dynamic>.from(
        await _client.get('/weather/current', {'city': city}),
      );

  Future<bool> ping() async {
    try {
      final res = await _client.get('/health');
      return (res as Map)['status'] == 'ok';
    } catch (_) {
      return false;
    }
  }
}
