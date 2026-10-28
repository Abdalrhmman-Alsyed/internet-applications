import 'package:dio/dio.dart';
import 'package:ecommerce_mobile/core/network/api_client.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  final request = RequestOptions(path: '/orders/1');

  test('parses the unified API error format', () {
    final e = DioException(
      requestOptions: request,
      response: Response(requestOptions: request, statusCode: 403, data: {
        'success': false,
        'statusCode': 403,
        'error': 'Forbidden',
        'message': 'You do not have access to this order',
      }),
    );
    final apiError = ApiException.fromDio(e);
    expect(apiError.statusCode, 403);
    expect(apiError.message, 'You do not have access to this order');
  });

  test('joins validation messages', () {
    final e = DioException(
      requestOptions: request,
      response: Response(requestOptions: request, statusCode: 400, data: {
        'statusCode': 400,
        'message': ['email must be an email', 'password is too weak'],
      }),
    );
    expect(ApiException.fromDio(e).message, 'email must be an email\npassword is too weak');
  });

  test('network failure becomes 503', () {
    expect(ApiException.fromDio(DioException(requestOptions: request)).statusCode, 503);
  });
}
