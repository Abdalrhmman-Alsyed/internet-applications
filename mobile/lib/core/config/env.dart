/// Backend URLs. The Android emulator reaches the host machine at 10.0.2.2.
/// Override for a real device on the same Wi-Fi:
///   flutter run --dart-define=API_URL=http://192.168.1.10:3000 --dart-define=WS_URL=http://192.168.1.10:3004
class Env {
  static const apiUrl = String.fromEnvironment('API_URL', defaultValue: 'http://10.0.2.2:3000');
  static const wsUrl = String.fromEnvironment('WS_URL', defaultValue: 'http://10.0.2.2:3004');

  static const apiBase = '$apiUrl/api/v1';
}
