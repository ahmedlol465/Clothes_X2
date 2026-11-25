import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:google_sign_in/google_sign_in.dart';
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

  /// The backend's own error message when it answered (401/409/400/...),
  /// or null when the backend was unreachable, so screens only show
  /// "backend offline" for a real network failure.
  String? get lastError => _lastError;

  static String? _friendlyError(Object e) =>
      e is ApiException && e.status != null ? e.message : null;

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
      _lastError = _friendlyError(e);
      return false;
    }
  }

  /// Google sign-in: runs the Google Identity flow with the server's public
  /// Client ID, then exchanges the Google ID token for our own session
  /// (POST /auth/google). Returns false without an error when the user
  /// cancels the Google sheet.
  Future<bool> loginWithGoogle() async {
    _lastError = null;
    try {
      final status = await api.googleClientStatus();
      final clientId = '${status['clientId'] ?? ''}';
      if (status['configured'] != true || clientId.isEmpty) {
        _lastError = 'Google sign-in is not configured on the server yet.';
        return false;
      }
      final google = GoogleSignIn(
        clientId: clientId,
        scopes: const ['email', 'profile'],
      );
      final account = await google.signIn();
      if (account == null) return false; // user cancelled
      final auth = await account.authentication;
      final idToken = auth.idToken;
      if (idToken == null || idToken.isEmpty) {
        _lastError = 'Google did not return an ID token. Try again.';
        return false;
      }
      final res = await api.loginWithGoogle(idToken);
      final user = res['user'];
      if (user is Map) {
        _profile = userProfileFromJson(user.cast<String, dynamic>());
      }
      await _persistToken('${res['accessToken'] ?? ''}');
      _status.markOnline();
      notifyListeners();
      return true;
    } catch (e) {
      if (e is ApiException) _status.markOffline(e);
      _lastError =
          _friendlyError(e) ?? 'Google sign-in failed. Please try again.';
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
      _lastError = _friendlyError(e);
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

  /// Revert to the default initial avatar (clears the uploaded/Google photo).
  Future<UserProfile?> removeAvatar() async {
    try {
      final user = await api.updateMe({'avatarUrl': null});
      _profile = userProfileFromJson(user);
      notifyListeners();
      return _profile;
    } on ApiException {
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
