import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:smartwardrobe/data/models.dart';

/// Backend contract test (§8 API Overview).
/// Hits the live backend (default http://localhost:3001, override with
/// `API_BASE_URL` env) and validates every response parses into app models.
/// Skips gracefully when the backend is not running.
void main() {
  final base = Platform.environment['API_BASE_URL'] ?? 'http://localhost:3001';

  Future<dynamic> call(
    String method,
    String path, {
    Map<String, dynamic>? body,
    String? token,
  }) async {
    final client = HttpClient();
    try {
      final req = await client.openUrl(method, Uri.parse('$base$path'));
      req.headers.contentType = ContentType.json;
      if (token != null) req.headers.set('authorization', 'Bearer $token');
      if (body != null) req.write(jsonEncode(body));
      final res = await req.close().timeout(const Duration(seconds: 8));
      final text = await res.transform(utf8.decoder).join();
      expect(res.statusCode, lessThan(400), reason: '$method $path → $text');
      return jsonDecode(text);
    } finally {
      client.close();
    }
  }

  test('backend contract: auth → wardrobe → AI → outfits → planner → shop', () async {
    // Backend reachable?
    try {
      await call('GET', '/health');
    } on SocketException {
      markTestSkipped('Backend not running at $base (run backend/npm start).');
      return;
    } on TimeoutException {
      markTestSkipped('Backend timed out at $base.');
      return;
    }

    // 8.1 auth
    final login = await call('POST', '/auth/login', body: {
      'email': 'karim@fashiontech.com',
      'password': 'wardrobe2024',
    }) as Map<String, dynamic>;
    final token = login['accessToken'] as String;
    expect(token, isNotEmpty);

    // 8.3 wardrobe
    final wardrobe = await call('GET', '/wardrobe/items') as Map<String, dynamic>;
    final items = [
      for (final j in (wardrobe['items'] as List)) ClothingItem.fromJson(Map<String, dynamic>.from(j as Map)),
    ];
    expect(items.length, greaterThanOrEqualTo(10));
    expect((wardrobe['categories'] as List), contains('Tops'));

    final created = await call('POST', '/wardrobe/items', body: {
      'name': 'Contract Test Tee',
      'category': 'Tops',
      'color': 'White',
    }, token: token) as Map<String, dynamic>;
    final newId = (created['item'] as Map)['id'] as String;

    final search = await call('GET', '/wardrobe/items?search=contract&category=All') as Map<String, dynamic>;
    expect((search['items'] as List), isNotEmpty);

    // 8.4 AI
    final analysis = await call('POST', '/ai/analyze-clothing', body: {
      'filename': 'navy_blazer_wool.jpg',
    }, token: token) as Map<String, dynamic>;
    expect((analysis['analysis'] as Map)['category'], 'Outerwear');

    final gen = await call('POST', '/ai/generate-outfit', body: {
      'occasion': 'date night',
      'count': 1,
    }, token: token) as Map<String, dynamic>;
    final outfit = Outfit.fromJson(Map<String, dynamic>.from((gen['outfits'] as List).first as Map));
    expect(outfit.match, greaterThan(70));
    expect(outfit.itemIds, isNotNull);
    expect(outfit.itemIds!.length, greaterThanOrEqualTo(3));

    final compat = await call('POST', '/ai/calculate-compatibility', body: {
      'itemIds': ['w1', 'w2', 'w4'],
      'occasion': 'university',
    }, token: token) as Map<String, dynamic>;
    expect(compat['match'], greaterThan(70));
    expect((compat['breakdown'] as List).length, 5);

    final chat = await call('POST', '/ai/chat', body: {
      'message': 'I have dinner tonight. What can I wear?',
    }, token: token) as Map<String, dynamic>;
    expect((chat['reply'] as String).length, greaterThan(20));

    // 8.5 outfits
    final rec = await call('GET', '/outfits/recommended?occasion=casual&count=1') as Map<String, dynamic>;
    expect((rec['outfits'] as List), isNotEmpty);

    // 8.6 planner + 8.7 shopping + 8.8 admin + weather
    final week = await call('GET', '/planner/weekly') as Map<String, dynamic>;
    expect((week['week'] as List).length, 7);

    final packing = await call('POST', '/travel/packing-list', body: {
      'destination': 'Dubai',
      'days': 5,
    }, token: token) as Map<String, dynamic>;
    expect((packing['items'] as List), isNotEmpty);

    final shop = await call('GET', '/shop/recommended') as Map<String, dynamic>;
    expect((shop['picks'] as List), isNotEmpty);

    final dash = await call('GET', '/admin/dashboard') as Map<String, dynamic>;
    expect(dash['wardrobeItems'], greaterThanOrEqualTo(10));

    // cleanup
    await call('DELETE', '/wardrobe/items/$newId', token: token);
  });
}
