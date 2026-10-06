import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:http_parser/http_parser.dart';

import 'api_config.dart';

/// Thrown when the backend answers with an error or is unreachable.
class ApiException implements Exception {
  ApiException(this.message, {this.status});

  final String message;
  final int? status;

  @override
  String toString() => 'ApiException($status): $message';
}

/// HTTP client for the SmartWardrobe backend (§8 API Overview).
/// Built on `package:http` so it works on **every** Flutter target —
/// Android, iOS, desktop **and Chrome/web**.
///
/// If the backend is down, methods throw [ApiException] and callers fall back
/// to the bundled mock data (offline demo mode).
class ApiClient {
  ApiClient({http.Client? httpClient}) : _http = httpClient ?? http.Client();

  final http.Client _http;
  String? _token;

  bool get hasToken => _token != null;
  void setToken(String? token) => _token = token;
  void clearToken() => _token = null;

  Future<dynamic> get(String path, [Map<String, String>? query]) =>
      _send('GET', path, query: query);

  Future<dynamic> post(
    String path, [
    Map<String, dynamic>? body,
    Duration? timeout,
  ]) =>
      _send('POST', path, body: body, timeout: timeout);

  Future<dynamic> patch(String path, [Map<String, dynamic>? body]) =>
      _send('PATCH', path, body: body);

  Future<dynamic> delete(String path) => _send('DELETE', path);

  /// Server-sent-events POST ([path]) used by the stylist stream.
  ///
  /// Yields `({String event, Map<String, dynamic> data})` for every `event:`
  /// frame. Works on every target because it reuses `package:http` rather than
  /// a browser-only `EventSource` (which cannot POST a body anyway).
  ///
  /// Events emitted by `POST /ai/chat/stream`:
  ///   `delta` → `{delta, synthetic?}`  text fragments
  ///   `error` → `{error, recoverable?}`
  ///   `done`  → the assembled turn (reply, outfit, weather, memory, source)
  Stream<({String event, Map<String, dynamic> data})> streamPost(
    String path,
    Map<String, dynamic> body, {
    Duration? timeout,
  }) async* {
    final uri = Uri.parse('${ApiConfig.baseUrl}$path');
    final request = http.Request('POST', uri)..headers.addAll(_headers);
    request.body = jsonEncode(body);

    final http.StreamedResponse response;
    try {
      response = await _http.send(request).timeout(timeout ?? ApiConfig.timeout);
    } on TimeoutException {
      throw ApiException('Stylist timed out.');
    } on http.ClientException {
      throw ApiException('Backend unreachable at ${ApiConfig.baseUrl}.');
    }
    if (response.statusCode >= 400) {
      // Drain the body so the error message survives the status code.
      var message = 'Stream failed (${response.statusCode})';
      try {
        final text = await response.stream.bytesToString();
        final decoded = text.isEmpty ? null : jsonDecode(text);
        if (decoded is Map && decoded['error'] != null) {
          message = decoded['error'].toString();
        }
      } catch (_) {
        // keep the generic message
      }
      throw ApiException(message, status: response.statusCode);
    }

    String? name;
    final dataLines = <String>[];
    await for (final line
        in response.stream.transform(utf8.decoder).transform(const LineSplitter())) {
      if (line.isEmpty) {
        final event = name;
        if (event != null) {
          Object? payload;
          final raw = dataLines.join('\n');
          if (raw.isNotEmpty) {
            try {
              payload = jsonDecode(raw);
            } catch (_) {
              payload = {'raw': raw};
            }
          }
          yield (
            event: event,
            data: payload is Map
                ? Map<String, dynamic>.from(payload)
                : {'value': payload},
          );
        }
        name = null;
        dataLines.clear();
        continue;
      }
      if (line.startsWith(':')) continue; // comment / keep-alive
      if (line.startsWith('event:')) {
        name = line.substring(6).trim();
      } else if (line.startsWith('data:')) {
        dataLines.add(line.substring(5).trim());
      }
    }
  }

  /// Multipart image upload for the Add Clothes flow (§8.3) and the avatar
  /// endpoint. [files] are (filename, bytes, mimeType) tuples. Returns decoded
  /// JSON.
  Future<dynamic> uploadPhotos(
    String path,
    List<({String filename, List<int> bytes, String mimeType})> files, {
    Duration? timeout,
    String field = 'photos',
  }) async {
    final uri = Uri.parse('${ApiConfig.baseUrl}$path');
    try {
      final request = http.MultipartRequest('POST', uri);
      if (_token != null) {
        request.headers['Authorization'] = 'Bearer $_token';
      }
      for (final f in files) {
        MediaType? contentType;
        try {
          contentType = MediaType.parse(f.mimeType);
        } catch (_) {
          contentType = MediaType('image', 'jpeg');
        }
        request.files.add(
          http.MultipartFile.fromBytes(
            field,
            f.bytes,
            filename: f.filename,
            contentType: contentType,
          ),
        );
      }
      final streamed = await _http
          .send(request)
          .timeout(timeout ?? ApiConfig.uploadTimeout);
      final res = await http.Response.fromStream(streamed);
      final decoded = res.body.isEmpty ? {} : jsonDecode(res.body);
      if (res.statusCode >= 400) {
        final msg = decoded is Map && decoded['error'] != null
            ? decoded['error'].toString()
            : 'Upload failed (${res.statusCode})';
        throw ApiException(msg, status: res.statusCode);
      }
      return decoded;
    } on TimeoutException {
      throw ApiException('Upload timed out.');
    } on http.ClientException {
      throw ApiException('Backend unreachable at ${ApiConfig.baseUrl}.');
    } catch (e) {
      if (e is ApiException) rethrow;
      throw ApiException('Backend unreachable at ${ApiConfig.baseUrl}.');
    }
  }

  Map<String, String> get _headers => {
        'Content-Type': 'application/json',
        if (_token != null) 'Authorization': 'Bearer $_token',
      };

  Future<dynamic> _send(
    String method,
    String path, {
    Map<String, String>? query,
    Map<String, dynamic>? body,
    Duration? timeout,
  }) async {
    final uri = Uri.parse('${ApiConfig.baseUrl}$path')
        .replace(queryParameters: query);
    try {
      final request = http.Request(method, uri)
        ..headers.addAll(_headers);
      if (body != null) request.body = jsonEncode(body);
      final streamed =
          await _http.send(request).timeout(timeout ?? ApiConfig.timeout);
      final res = await http.Response.fromStream(streamed);
      final decoded = res.body.isEmpty ? {} : jsonDecode(res.body);
      if (res.statusCode >= 400) {
        final msg = decoded is Map && decoded['error'] != null
            ? decoded['error'].toString()
            : 'Request failed (${res.statusCode})';
        throw ApiException(msg, status: res.statusCode);
      }
      return decoded;
    } on TimeoutException {
      throw ApiException('Backend timed out.');
    } on http.ClientException {
      throw ApiException('Backend unreachable at ${ApiConfig.baseUrl}.');
    } catch (e) {
      if (e is ApiException) rethrow;
      throw ApiException('Backend unreachable at ${ApiConfig.baseUrl}.');
    }
  }
}
