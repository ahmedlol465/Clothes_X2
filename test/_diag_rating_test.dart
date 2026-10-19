import 'package:flutter/foundation.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:smartwardrobe/core/api/api_client.dart';
import 'package:smartwardrobe/core/api/api_config.dart';
import 'package:smartwardrobe/core/api/smartwardrobe_api.dart';

void main() {
  setUp(() => debugDefaultTargetPlatformOverride = TargetPlatform.windows);
  tearDown(() => debugDefaultTargetPlatformOverride = null);

  test('diag: app ApiClient rateOutfit against live backend', () async {
    // ignore: avoid_print
    print('DIAG baseUrl=${ApiConfig.baseUrl}');
    final client = ApiClient();
    final api = SmartWardrobeApi(client);
    try {
      final saved = await api.rateOutfit('diag-probe-1', 3);
      // ignore: avoid_print
      print('DIAG SUCCESS saved=$saved');
    } on ApiException catch (e) {
      // ignore: avoid_print
      print('DIAG ApiException status=${e.status} message=${e.message}');
    } catch (e) {
      // ignore: avoid_print
      print('DIAG OTHER ${e.runtimeType}: $e');
    }
  });
}
