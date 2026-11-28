import 'package:flutter/foundation.dart';

import '../../core/api/api_client.dart';
import '../../core/api/smartwardrobe_api.dart';
import '../assets.dart';
import '../backend_status.dart';
import '../models.dart';
import '../wardrobe_filters.dart';
import '../dto/mappers.dart';

/// Wardrobe CRUD, photo import and the Add Clothes analysis flow.
class WardrobeController extends ChangeNotifier {
  WardrobeController({
    required SmartWardrobeApi api,
    required BackendStatus status,
  })  : _api = api,
        _status = status;

  static const String notClothingMessage =
      "This photo doesn't look like clothing. Tap it to retry with a garment photo.";

  static const String sessionExpiredMessage =
      'Your session expired. Sign out and sign in again, then retry the photo.';

  final SmartWardrobeApi _api;
  final BackendStatus _status;

  bool loading = false;
  List<ClothingItem> items = [];
  List<String> filters = [...wardrobeFilterOptions];

  Future<void> load({String search = '', String category = 'All'}) async {
    loading = true;
    notifyListeners();
    try {
      final res = await _api.wardrobeItems(search: search, category: category);
      items = [
        for (final j in (res['items'] as List))
          clothingItemFromJson(Map<String, dynamic>.from(j as Map)),
      ];
      final cats = (res['categories'] as List?)?.map((c) => '$c').toList();
      if (cats != null && cats.isNotEmpty) filters = cats;
      _status.markOnline();
    } catch (e) {
      _status.markOffline(e);
      // Keep the last successfully loaded rows (if any). There is no bundled
      // fallback: an empty wardrobe is the honest state when the API is down.
    } finally {
      loading = false;
      notifyListeners();
    }
  }

  /// Stages one picked photo: uploads bytes, then runs vision analysis on the
  /// stored pixels. Returns the public URL + analysis + source.
  Future<({String url, Map<String, dynamic> analysis, String source})>
      stagePhoto({
    required String filename,
    required List<int> bytes,
    required String mimeType,
  }) async {
    final stored = await _api.uploadWardrobePhotos(
      [(filename: filename, bytes: bytes, mimeType: mimeType)],
    );
    final url = '${stored.first['url'] ?? ''}';
    try {
      final res = await _api.analyzePhoto(imageUrl: url, filename: filename);
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
        // A rejection (422) must never be wrapped in default garment tags.
        if (e.status == 422) {
          throw ApiException(notClothingMessage, status: 422);
        }
        if (e.status == 401) {
          throw ApiException(sessionExpiredMessage, status: 401);
        }
        rethrow;
      }
      return (url: url, analysis: <String, dynamic>{}, source: 'heuristic');
    } catch (_) {
      return (url: url, analysis: <String, dynamic>{}, source: 'heuristic');
    }
  }

  Future<ClothingItem> addItem(Map<String, dynamic> item) async {
    final res = await _api.createWardrobeItem(item);
    final created = clothingItemFromJson(
      Map<String, dynamic>.from((res['item'] as Map?) ?? res),
    );
    _status.markOnline();
    await load();
    return created;
  }

  /// Real photo import: upload, analyse, then save each garment.
  /// Throws [ApiException] when the backend is unreachable — no demo data.
  Future<List<ClothingItem>> importPhotos(
    List<({String filename, List<int> bytes, String mimeType})> photos, {
    void Function(int done, int total, String stage)? onProgress,
  }) async {
    final total = photos.length;
    onProgress?.call(0, total, 'upload');
    final stored = await _api.uploadWardrobePhotos(photos);
    final created = <ClothingItem>[];
    for (var i = 0; i < stored.length; i++) {
      final file = stored[i];
      final url = '${file['url'] ?? ''}';
      final filename = '${file['filename'] ?? photos[i].filename}';
      onProgress?.call(i, total, 'analyze');
      Map<String, dynamic> analysis = const {};
      String source = 'heuristic';
      try {
        final res = await _api.analyzePhoto(
          imageUrl: url,
          filename: filename,
        );
        analysis = (res['analysis'] as Map?)?.cast<String, dynamic>() ?? {};
        source = '${res['source'] ?? 'heuristic'}';
      } on ApiException catch (e) {
        if (e.status == 422) {
          throw ApiException(notClothingMessage, status: 422);
        }
        if (e.status == 401) {
          throw ApiException(sessionExpiredMessage, status: 401);
        }
        if (e.status != null) rethrow;
        // Unreachable backend → keep filename heuristics below.
      } catch (_) {
        // Analyze must never block saving: fall back to filename heuristics.
      }
      onProgress?.call(i, total, 'save');
      final itemRes = await _api.createWardrobeItem({
        'name': '${analysis['suggestedName'] ?? filename.split('.').first}',
        'image': url,
        'category': '${analysis['category'] ?? 'Tops'}',
        'color': '${analysis['color'] ?? 'White'}',
        'style': '${analysis['style'] ?? 'Casual'}',
        'material': '${analysis['material'] ?? 'Cotton'}',
        'season': '${analysis['season'] ?? 'All Season'}',
        'formality': '${analysis['formality'] ?? 'Casual'}',
        'pattern': '${analysis['pattern'] ?? 'Plain'}',
        'analysisSource': source,
      });
      created.add(
        clothingItemFromJson(
          Map<String, dynamic>.from((itemRes['item'] as Map?) ?? itemRes),
        ),
      );
      onProgress?.call(i + 1, total, 'save');
    }
    _status.markOnline();
    await load();
    return created;
  }

  /// Runs AI analysis then saves the garment.
  Future<ClothingItem?> analyzeAndAdd({
    required String name,
    String filename = 'upload.jpg',
    String image = Img.teeWhite,
  }) async {
    try {
      final analysis = await _api.analyzeClothing({
        'filename': filename,
        'name': name,
      });
      final a = (analysis['analysis'] as Map?) ?? analysis;
      final created = await _api.createWardrobeItem({
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
      final item = clothingItemFromJson(
        Map<String, dynamic>.from((created['item'] as Map?) ?? created),
      );
      _status.markOnline();
      await load();
      return item;
    } catch (e) {
      _status.markOffline(e);
      return null;
    }
  }

  Future<bool> update(String id, Map<String, dynamic> patch) async {
    try {
      final res = await _api.updateWardrobeItem(id, patch);
      final updated = clothingItemFromJson(
        Map<String, dynamic>.from((res['item'] as Map?) ?? res),
      );
      final i = items.indexWhere((w) => w.id == id);
      if (i >= 0) items[i] = updated;
      _status.markOnline();
      notifyListeners();
      return true;
    } catch (e) {
      _status.markOffline(e);
      return false;
    }
  }

  Future<bool> delete(String id) async {
    try {
      await _api.deleteWardrobeItem(id);
      items.removeWhere((w) => w.id == id);
      _status.markOnline();
      notifyListeners();
      return true;
    } catch (e) {
      _status.markOffline(e);
      return false;
    }
  }

  Future<bool> logWear(ClothingItem item) => update(item.id, {
        'timesWorn': item.timesWorn + 1,
        'lastWornLabel': 'Worn today',
      });

  void reset() {
    loading = false;
    items = [];
    filters = [...wardrobeFilterOptions];
  }
}
