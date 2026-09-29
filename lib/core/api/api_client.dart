import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

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

  Future<dynamic> post(String path, [Map<String, dynamic>? body]) =>
      _send('POST', path, body: body);

  Future<dynamic> patch(String path, [Map<String, dynamic>? body]) =>
      _send('PATCH', path, body: body);

  Future<dynamic> delete(String path) => _send('DELETE', path);

  Map<String, String> get _headers => {
        'Content-Type': 'application/json',
        if (_token != null) 'Authorization': 'Bearer $_token',
      };

  Future<dynamic> _send(
    String method,
    String path, {
    Map<String, String>? query,
    Map<String, dynamic>? body,
  }) async {
    final uri = Uri.parse('${ApiConfig.baseUrl}$path')
        .replace(queryParameters: query);
    try {
      final request = http.Request(method, uri)
        ..headers.addAll(_headers);
      if (body != null) request.body = jsonEncode(body);
      final streamed =
          await _http.send(request).timeout(ApiConfig.timeout);
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
