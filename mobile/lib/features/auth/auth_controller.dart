import 'package:flutter/foundation.dart';

import '../../core/models.dart';
import '../../core/network/api_client.dart';

/// Holds the signed-in user. Tokens are kept by [ApiClient.tokens] (secure storage).
class AuthController extends ChangeNotifier {
  AuthController(this.api) {
    api.onSessionExpired = () {
      if (_user != null) {
        _user = null;
        notifyListeners();
      }
    };
  }

  final ApiClient api;
  User? _user;
  bool _loading = true;

  User? get user => _user;
  bool get loading => _loading;

  /// Restores the session from stored tokens (refreshing them if needed).
  Future<void> restore() async {
    if (await api.tokens.accessToken != null) {
      try {
        _user = User.fromJson(await api.get<Map<String, dynamic>>('/users/me'));
      } catch (_) {
        await api.tokens.clear();
      }
    }
    _loading = false;
    notifyListeners();
  }

  Future<void> login(String email, String password) async {
    final res = await api.post<Map<String, dynamic>>('/auth/login', data: {'email': email.trim(), 'password': password});
    await _accept(res);
  }

  Future<void> register({required String name, required String email, required String password, String? phone}) async {
    final res = await api.post<Map<String, dynamic>>('/auth/register', data: {
      'name': name.trim(),
      'email': email.trim(),
      'password': password,
      if (phone != null && phone.trim().isNotEmpty) 'phone': phone.trim(),
    });
    await _accept(res);
  }

  Future<void> updateProfile({required String name, String? phone}) async {
    final res = await api.patch<Map<String, dynamic>>('/users/me', data: {
      'name': name.trim(),
      if (phone != null && phone.trim().isNotEmpty) 'phone': phone.trim(),
    });
    _user = User.fromJson(res);
    notifyListeners();
  }

  Future<void> logout() async {
    try {
      await api.post('/auth/logout');
    } catch (_) {}
    await api.tokens.clear();
    _user = null;
    notifyListeners();
  }

  Future<void> _accept(Map<String, dynamic> res) async {
    await api.tokens.save(accessToken: res['accessToken'], refreshToken: res['refreshToken']);
    _user = User.fromJson(res['user']);
    notifyListeners();
  }
}
