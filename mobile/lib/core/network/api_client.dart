import 'package:dio/dio.dart';

import '../config/env.dart';
import '../storage/token_storage.dart';

/// Error returned by the API: { success, statusCode, error, message, path, method, timestamp }.
class ApiException implements Exception {
  ApiException(this.statusCode, this.message);

  final int statusCode;
  final String message;

  factory ApiException.fromDio(DioException e) {
    final data = e.response?.data;
    if (data is Map && data['statusCode'] != null) {
      final msg = data['message'];
      return ApiException(data['statusCode'] as int, msg is List ? msg.join('\n') : '$msg');
    }
    return ApiException(503, 'Cannot reach the server');
  }

  @override
  String toString() => message;
}

/// Single Dio instance: attaches the access token, and on 401 refreshes it once
/// (refresh tokens are rotated by the backend) and retries the request.
class ApiClient {
  ApiClient(this._tokens) {
    dio.interceptors.add(
      InterceptorsWrapper(
        onRequest: (options, handler) async {
          final token = await _tokens.accessToken;
          if (token != null) options.headers['Authorization'] = 'Bearer $token';
          handler.next(options);
        },
        onError: (e, handler) async {
          final isRetry = e.requestOptions.extra['retried'] == true;
          if (e.response?.statusCode == 401 && !isRetry && await _refresh()) {
            final options = e.requestOptions..extra['retried'] = true;
            options.headers['Authorization'] = 'Bearer ${await _tokens.accessToken}';
            return handler.resolve(await dio.fetch(options));
          }
          handler.next(e);
        },
      ),
    );
  }

  final TokenStorage _tokens;
  final dio = Dio(BaseOptions(baseUrl: Env.apiBase, connectTimeout: const Duration(seconds: 10)));

  Future<bool> _refresh() async {
    final refreshToken = await _tokens.refreshToken;
    if (refreshToken == null) return false;
    try {
      final res = await Dio(BaseOptions(baseUrl: Env.apiBase)).post('/auth/refresh', data: {'refreshToken': refreshToken});
      await _tokens.save(accessToken: res.data['accessToken'], refreshToken: res.data['refreshToken']);
      return true;
    } on DioException {
      await _tokens.clear();
      return false;
    }
  }

  Future<T> get<T>(String path, {Map<String, dynamic>? query}) => _wrap(() => dio.get<T>(path, queryParameters: query));

  Future<T> post<T>(String path, {Object? data}) => _wrap(() => dio.post<T>(path, data: data));

  Future<T> patch<T>(String path, {Object? data}) => _wrap(() => dio.patch<T>(path, data: data));

  Future<T> _wrap<T>(Future<Response<T>> Function() call) async {
    try {
      return (await call()).data as T;
    } on DioException catch (e) {
      throw ApiException.fromDio(e);
    }
  }
}
