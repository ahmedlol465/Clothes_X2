import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../../core/api/api_client.dart';
import '../../core/api/smartwardrobe_api.dart';
import '../backend_status.dart';
import '../models.dart';
import '../dto/mappers.dart';

/// Authentication and the signed-in user's profile.
///
/// Owns the only mutable token state. [AppState] composes this controller with
/// the feature controllers so screens keep their single listenable.
class AccountController extends ChangeNotifier {
  AccountController({
    required ApiClient client,
    required this.api,
    required BackendStatus status,
  })  : _client = client,
        _status = status;

  static const String _tokenKey = 'sw.authToken';

  final ApiClient _client;
  final SmartWardrobeApi api;
  final BackendStatus _status;

  SharedPreferences? _prefs;

  /// Called after the local session is cleared so the composition root can
  /// reset every user-scoped cache.
  void Function()? onSessionCleared;

  bool authChecked = false;
  bool authRestoring = false;

  UserProfile? _profile;
  UserProfile? get profile => _profile;
  bool get isAuthenticated => _profile != null;

  bool profileLoading = false;
  String? profileError;
  bool profileSettled = false;
  bool avatarUploading = false;

  String? _lastError;
  String? get lastError => _lastError;

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
      _profile = userProfileFromJson(user);
      _status.markOnline();
      return true;
    } on ApiException catch (e) {
      // 401/403 means the server dropped the session. Anything else is a
      // network problem: keep the token so the next launch can retry.
      if (e.status == 401 || e.status == 403) {
        await _dropSession();
      }
      _status.markOffline(e);
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
    _lastError = null;
    try {
      final res = await api.login(email, password);
      final user = res['user'];
      if (user is Map) {
        _profile = userProfileFromJson(user.cast<String, dynamic>());
      }
      await _persistToken('${res['accessToken'] ?? ''}');
      _status.markOnline();
      notifyListeners();
      return true;
    } catch (e) {
      _status.markOffline(e);
      _lastError = e.toString();
      return false;
    }
  }

  Future<bool> register(String name, String email, String password) async {
    _lastError = null;
    try {
      final res = await api.register(name, email, password);
      final user = res['user'];
      if (user is Map) {
        _profile = userProfileFromJson(user.cast<String, dynamic>());
      }
      await _persistToken('${res['accessToken'] ?? ''}');
      _status.markOnline();
      notifyListeners();
      return true;
    } catch (e) {
      _status.markOffline(e);
      _lastError = e.toString();
      return false;
    }
  }

  Future<void> logout() async {
    try {
      await api.logout();
    } catch (_) {
      // The local session must still be dropped if the revoke call fails.
    }
    await _dropSession();
    profileError = null;
    profileLoading = false;
    profileSettled = false;
    avatarUploading = false;
    onSessionCleared?.call();
    notifyListeners();
  }

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
      _profile = userProfileFromJson(user);
      _status.markOnline();
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
        unawaited(_dropSession());
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

  Future<UserProfile?> saveStyleProfile(UserProfile draft) async {
    try {
      final saved = await api.updateStyleProfile(styleProfileToJson(draft));
      // Re-read the whole user so name/email/createdAt stay authoritative and
      // the saved style fields come from the server, not from the draft.
      final user = await api.currentUser();
      _profile = userProfileFromJson({
        ...user,
        'styleProfile': {
          ...(user['styleProfile'] as Map? ?? const {}),
          ...saved,
        },
      });
      _status.markOnline();
      notifyListeners();
      return _profile;
    } on ApiException catch (e) {
      if (e.status == 401 || e.status == 403) {
        unawaited(_dropSession());
      }
      _status.markOffline(e);
      return null;
    }
  }

  Future<UserProfile?> updateName(String name) async {
    final trimmed = name.trim();
    if (trimmed.isEmpty) return null;
    try {
      final user = await api.updateMe({'name': trimmed});
      _profile = _profile == null
          ? userProfileFromJson(user)
          : _profile!.copyWith(
              name: '${user['name'] ?? trimmed}',
              avatarUrl: '${user['avatarUrl'] ?? ''}'.isEmpty
                  ? null
                  : '${user['avatarUrl']}',
            );
      _status.markOnline();
      notifyListeners();
      return _profile;
    } on ApiException catch (e) {
      _status.markOffline(e);
      return null;
    }
  }

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
      _profile = userProfileFromJson(user);
      _status.markOnline();
      avatarUploading = false;
      notifyListeners();
      return _profile;
    } on ApiException catch (e) {
      avatarUploading = false;
      if (e.status == 401 || e.status == 403) {
        unawaited(_dropSession());
      }
      _status.markOffline(e);
      notifyListeners();
      return null;
    } catch (e) {
      avatarUploading = false;
      _status.markOffline(e);
      notifyListeners();
      return null;
    }
  }

  Future<void> _dropSession() async {
    _profile = null;
    _client.clearToken();
    _prefs ??= await SharedPreferences.getInstance();
    await _prefs?.remove(_tokenKey);
  }
}
