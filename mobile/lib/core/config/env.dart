/// Backend URLs. The Android emulator reaches the host machine at 10.0.2.2.
/// Override for a real device on the same Wi-Fi:
///   flutter run --dart-define=API_URL=http://192.168.1.10:3000 --dart-define=WS_URL=http://192.168.1.10:3004
class Env {
  static const apiUrl = String.fromEnvironment('API_URL', defaultValue: 'http://10.0.2.2:3000');
  static const wsUrl = String.fromEnvironment('WS_URL', defaultValue: 'http://10.0.2.2:3004');

  static const apiBase = '$apiUrl/api/v1';

  /// Image URLs come back as http://localhost:9000/... (the browser's view).
  /// On a phone "localhost" is the phone itself, so point them at the API host.
  static String fixUrl(String url) {
    final uri = Uri.tryParse(url);
    if (uri == null || (uri.host != 'localhost' && uri.host != '127.0.0.1')) return url;
    return uri.replace(host: Uri.parse(apiUrl).host).toString();
  }
}
