import 'package:dio/dio.dart';

import '../config/env.dart';
import '../storage/token_storage.dart';

/// Error returned by the API: { success, statusCode, error, message, path, method, timestamp }.
class ApiException implements Exception {
  ApiException(this.statusCode, this.message, {this.error, this.body});

  final int statusCode;
  final String message;
  final String? error;
  final Object? body;

  factory ApiException.fromDio(DioException e) {
    final data = e.response?.data;
    if (data is Map && data['statusCode'] != null) {
      final msg = data['message'];
      return ApiException(
        data['statusCode'] as int,
        msg is List ? msg.join('\n') : '$msg',
        error: data['error'] as String?,
        body: data,
      );
    }
    return ApiException(503, 'Cannot reach the server');
  }

  @override
  String toString() => message;
}

/// Result of a call that never throws on HTTP errors (security tests).
class RawResult {
  RawResult(this.status, this.body, this.ms);

  final int status;
  final Object? body;
  final int ms;
}

/// Single Dio instance: attaches the access token, and on 401 refreshes it once
/// (refresh tokens are rotated by the backend) and retries the request.
class ApiClient {
  ApiClient(this.tokens) {
    dio.interceptors.add(
      InterceptorsWrapper(
        onRequest: (options, handler) async {
          final token = await tokens.accessToken;
          if (token != null) options.headers['Authorization'] = 'Bearer $token';
          handler.next(options);
        },
        onError: (e, handler) async {
          final isRetry = e.requestOptions.extra['retried'] == true;
          final isAuthRoute = e.requestOptions.path.startsWith('/auth/');
          if (e.response?.statusCode == 401 && !isRetry && !isAuthRoute) {
            if (await _refresh()) {
              final options = e.requestOptions..extra['retried'] = true;
              options.headers['Authorization'] = 'Bearer ${await tokens.accessToken}';
              return handler.resolve(await dio.fetch(options));
            }
            onSessionExpired?.call();
          }
          handler.next(e);
        },
      ),
    );
  }

  final TokenStorage tokens;
  final dio = Dio(BaseOptions(baseUrl: Env.apiBase, connectTimeout: const Duration(seconds: 10)));
  final _plain = Dio(BaseOptions(baseUrl: Env.apiBase, connectTimeout: const Duration(seconds: 10), validateStatus: (_) => true));

  /// Called when the refresh token is no longer valid; the app logs out.
  void Function()? onSessionExpired;

  Future<bool> _refresh() async {
    final refreshToken = await tokens.refreshToken;
    if (refreshToken == null) return false;
    final res = await _plain.post('/auth/refresh', data: {'refreshToken': refreshToken});
    if (res.statusCode != 200) {
      await tokens.clear();
      return false;
    }
    await tokens.save(accessToken: res.data['accessToken'], refreshToken: res.data['refreshToken']);
    return true;
  }

  Future<T> get<T>(String path, {Map<String, dynamic>? query}) => _wrap(() => dio.get<T>(path, queryParameters: query));

  Future<T> post<T>(String path, {Object? data}) => _wrap(() => dio.post<T>(path, data: data));

  Future<T> patch<T>(String path, {Object? data}) => _wrap(() => dio.patch<T>(path, data: data));

  Future<T> delete<T>(String path) => _wrap(() => dio.delete<T>(path));

  /// Sends a request with an explicit token (or none) and returns whatever the server answered.
  Future<RawResult> raw(String method, String path, {Object? data, String? token}) async {
    final watch = Stopwatch()..start();
    try {
      final res = await _plain.request<Object?>(
        path,
        data: data,
        options: Options(method: method, headers: {if (token != null) 'Authorization': 'Bearer $token'}),
      );
      return RawResult(res.statusCode ?? 0, res.data, watch.elapsedMilliseconds);
    } on DioException {
      return RawResult(0, 'Cannot reach the server', watch.elapsedMilliseconds);
    }
  }

  Future<T> _wrap<T>(Future<Response<T>> Function() call) async {
    try {
      return (await call()).data as T;
    } on DioException catch (e) {
      throw ApiException.fromDio(e);
    }
  }
}
