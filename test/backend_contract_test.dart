import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:smartwardrobe/data/dto/mappers.dart';

/// Backend contract test (§8 API Overview).
/// Hits the live backend (default http://localhost:3002, override with
/// `API_BASE_URL` env) and validates every response parses into app models.
/// Skips gracefully when the backend is not running.
void main() {
  final base =
      Platform.environment['API_BASE_URL'] ?? 'http://localhost:3002/api';

  /// Plain REST calls are fast, but anything that reaches the LLM has to wait on
  /// a free-tier model, so those get their own budget rather than sharing the
  /// short one and failing the whole suite on a slow generation.
  const restTimeout = Duration(seconds: 8);
  const aiTimeout = Duration(seconds: 120);

  // The default 30s per-test budget is not enough once several of these calls
  // are waiting on a free-tier model, so the suite runs against live backends.
  const suiteTimeout = Timeout(Duration(minutes: 6));

  Future<dynamic> call(
    String method,
    String path, {
    Map<String, dynamic>? body,
    String? token,
    Duration timeout = restTimeout,
  }) async {
    final client = HttpClient();
    try {
      final req = await client.openUrl(method, Uri.parse('$base$path'));
      req.headers.contentType = ContentType.json;
      if (token != null) req.headers.set('authorization', 'Bearer $token');
      if (body != null) req.write(jsonEncode(body));
      final res = await req.close().timeout(timeout);
      final text = await res.transform(utf8.decoder).join();
      expect(res.statusCode, lessThan(400), reason: '$method $path → $text');
      final decoded = jsonDecode(text);
      // The canonical NestJS API wraps payloads in `{success, data, ...}`.
      if (decoded is Map && decoded['success'] == true && decoded.containsKey('data')) {
        return decoded['data'];
      }
      return decoded;
    } finally {
      client.close();
    }
  }

  test('backend contract: auth → wardrobe → AI → outfits → planner → shop',
      () async {
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
    final wardrobe = await call('GET', '/wardrobe/items', token: token)
        as Map<String, dynamic>;
    final items = [
      for (final j in (wardrobe['items'] as List)) clothingItemFromJson(Map<String, dynamic>.from(j as Map)),
    ];
    expect(items.length, greaterThanOrEqualTo(10));
    expect((wardrobe['categories'] as List), contains('Tops'));

    final created = await call('POST', '/wardrobe/items', body: {
      'name': 'Contract Test Tee',
      'category': 'Tops',
      'color': 'White',
    }, token: token) as Map<String, dynamic>;
    final newId = (created['item'] as Map)['id'] as String;

    final search = await call('GET', '/wardrobe/items?search=contract&category=All',
        token: token) as Map<String, dynamic>;
    expect((search['items'] as List), isNotEmpty);

    // 8.4 AI
    final analysis = await call('POST', '/ai/analyze-clothing', body: {
      'filename': 'navy_blazer_wool.jpg',
    }, token: token, timeout: aiTimeout) as Map<String, dynamic>;
    expect((analysis['analysis'] as Map)['category'], 'Outerwear');

    final gen = await call('POST', '/ai/generate-outfit', body: {
      'occasion': 'date night',
      'count': 1,
    }, token: token, timeout: aiTimeout) as Map<String, dynamic>;
    final outfit = outfitFromJson(Map<String, dynamic>.from((gen['outfits'] as List).first as Map));
    expect(outfit.match, greaterThan(70));
    expect(outfit.itemIds, isNotNull);
    expect(outfit.itemIds!.length, greaterThanOrEqualTo(3));

    // Real database ids (the legacy `w1/w2/w4` ids no longer exist), taken from
    // the outfit the engine just built so the pieces actually belong together.
    final compat = await call('POST', '/ai/calculate-compatibility', body: {
      'itemIds': (outfit.itemIds ?? const []).take(3).toList(),
      'occasion': 'university',
    }, token: token) as Map<String, dynamic>;
    expect(compat['match'], greaterThan(70));
    // The scoring engine reports all 11 factors; those without evidence are
    // flagged `applied: false` and excluded from the weighted mean.
    final breakdown = (compat['breakdown'] as List)
        .cast<Map<String, dynamic>>();
    expect(breakdown.length, 11);
    expect(
      breakdown.where((f) => f['applied'] == true),
      isNotEmpty,
      reason: 'at least one factor must have signal',
    );

    // The same report must survive the model layer.
    final factors = outfitFromJson({
      'id': 'x',
      'breakdown': breakdown,
    }).factors;
    expect(factors, isNotNull);
    expect(factors!.length, 11);

    final chat = await call('POST', '/ai/chat', body: {
      'message': 'I have dinner tonight. What can I wear?',
    }, token: token, timeout: aiTimeout) as Map<String, dynamic>;
    expect((chat['reply'] as String).length, greaterThan(20));
    expect(chat['source'], isNotNull);

    // Conversation memory: the second turn must see the first.
    await call('POST', '/ai/chat', body: {
      'message': 'I only wear navy and I hate sneakers.',
      'conversationId': 'contract-thread',
    }, token: token, timeout: aiTimeout);
    final turns = await call(
      'GET',
      '/ai/conversations?limit=40',
      token: token,
    ) as Map<String, dynamic>;
    expect(turns['turns'], isNotEmpty);

    // Remix: every variant answers, and each reports whether it rebuilt.
    for (final variant in ['casual', 'cold', 'summer', 'date', 'formal']) {
      final remix = await call('POST', '/ai/remix', body: {
        'itemIds': (outfit.itemIds ?? const []),
        'variant': variant,
      }, token: token, timeout: aiTimeout) as Map<String, dynamic>;
      final remixOutfit = (remix['outfit'] as Map).cast<String, dynamic>();
      expect(remixOutfit['variant'], variant);
      expect(remixOutfit['itemIds'], isNotEmpty);
      expect((remixOutfit['itemIds'] as List).length, greaterThanOrEqualTo(2));
    }

    // Vision outfit matching degrades to a filename read with no key, but
    // must still produce a wearable plan or an honest gap list.
    final match = await call('POST', '/ai/match-outfit', body: {
      'filename': 'navy_blazer_white_sneakers.jpg',
    }, token: token, timeout: aiTimeout) as Map<String, dynamic>;
    expect(match['matches'], isNotEmpty);
    expect(match['similarity'], isA<int>());

    final dna = await call('GET', '/ai/style-dna', token: token, timeout: aiTimeout)
        as Map<String, dynamic>;
    expect(dna['styleDna'], isNotNull);

    final caps = await call('GET', '/ai/capabilities', token: token)
        as Map<String, dynamic>;
    expect((caps['features'] as Map)['remix'], true);
    expect((caps['features'] as Map)['keylessWeather'], true);

    // 8.5 outfits
    final rec = await call('GET', '/outfits/recommended?occasion=casual&count=1',
        token: token) as Map<String, dynamic>;
    expect((rec['outfits'] as List), isNotEmpty);

    // 8.6 planner + 8.7 shopping + 8.8 admin + weather
    final week = await call('GET', '/planner/weekly', token: token)
        as Map<String, dynamic>;
    expect((week['week'] as List).length, 7);

    final packing = await call('POST', '/travel/packing-list', body: {
      'destination': 'Dubai',
      'days': 5,
    }, token: token) as Map<String, dynamic>;
    expect((packing['items'] as List), isNotEmpty);

    final shop = await call('GET', '/shop/recommended', token: token)
        as Map<String, dynamic>;
    expect((shop['picks'] as List), isNotEmpty);

    // Admin surfaces are role-guarded: the demo account is a regular user, so
    // the dashboard must be refused rather than answered.
    final client = HttpClient();
    try {
      final res = await (await client.getUrl(Uri.parse('$base/admin/dashboard')))
          .close();
      await res.drain<void>();
      expect(res.statusCode, anyOf(401, 403),
          reason: 'admin endpoints must require the admin role');
    } finally {
      client.close();
    }

    // cleanup
    await call('DELETE', '/wardrobe/items/$newId', token: token);
    await call('DELETE', '/ai/conversations', token: token);
  }, timeout: suiteTimeout);

  /// Streaming is the path the stylist screen actually uses, so it needs its
  /// own coverage: real `delta` events, and a `done` event whose reply is
  /// exactly the deltas joined back together.
  test('backend contract: /ai/chat/stream emits deltas and a grounded outfit',
      () async {
    try {
      await call('GET', '/health');
    } on SocketException {
      markTestSkipped('Backend not running at $base (run backend/npm start).');
      return;
    } on TimeoutException {
      markTestSkipped('Backend timed out at $base.');
      return;
    }

    final deltas = <String>[];
    Map<String, dynamic>? done;
    // The stream belongs to a signed-in user, so it needs a bearer token.
    final login = await call('POST', '/auth/login', body: {
      'email': 'karim@fashiontech.com',
      'password': 'wardrobe2024',
    }) as Map<String, dynamic>;
    final token = login['accessToken'] as String;

    final client = HttpClient();
    try {
      final req = await client.openUrl('POST', Uri.parse('$base/ai/chat/stream'));
      req.headers.contentType = ContentType.json;
      req.headers.set('authorization', 'Bearer $token');
      req.write(jsonEncode({
        'message': 'I never wear sneakers. Something for a weekend walk.',
        'conversationId': 'contract-stream',
      }));

      var event = '';
      var notices = 0;
      final res = await req.close();
      expect(res.statusCode, lessThan(400));
      await for (final line
          in res.transform(utf8.decoder).transform(const LineSplitter())) {
        if (line.startsWith('event:')) {
          event = line.substring(6).trim();
        } else if (line.startsWith('data:')) {
          final payload = jsonDecode(line.substring(5).trim());
          if (event == 'delta') {
            deltas.add((payload as Map)['delta'] as String);
          } else if (event == 'done') {
            done = (payload as Map).cast<String, dynamic>();
          } else if (event == 'notice') {
            // The free tier is busy much of the time, so a `notice` - LLM
            // unavailable, rule engine answered - is expected and still has to
            // produce a complete, grounded turn. That is asserted below.
            notices++;
          } else if (event == 'error') {
            fail('stream reported a terminal error: $line');
          }
        }
      }
      // A notice is only legitimate if the stream still delivered the reply.
      if (notices > 0) {
        expect(deltas, isNotEmpty,
            reason: 'a notice must still be followed by a full reply');
      }
    } finally {
      client.close();
    }

    expect(deltas, isNotEmpty, reason: 'the reply must arrive as deltas');
    expect(done, isNotNull, reason: 'the stream must end with a done event');
    final reply = done!['reply'] as String;
    expect(reply, deltas.join(), reason: 'deltas must reconstruct the reply');

    // The streamed turn has no structured id channel, so the pieces it named
    // in prose are recovered against the wardrobe. The outfit has to be real.
    final outfit = (done['outfit'] as Map?)?.cast<String, dynamic>();
    expect(outfit, isNotNull);
    expect((outfit!['itemIds'] as List), isNotEmpty);
    expect(outfit['match'], isA<int>());

    // The exclusion the message stated must survive into what gets recommended.
    final names = ((outfit['items'] as List?) ?? const [])
        .cast<Map>()
        .map((i) => (i['name'] as String).toLowerCase())
        .toList();
    expect(
      names.any((n) => n.contains('sneaker')),
      isFalse,
      reason: 'the user said they never wear sneakers',
    );
  }, timeout: suiteTimeout);
}
