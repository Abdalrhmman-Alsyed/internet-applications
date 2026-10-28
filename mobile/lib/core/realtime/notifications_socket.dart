import 'package:socket_io_client/socket_io_client.dart' as io;

import '../config/env.dart';

/// Real-time notifications from notifications-service (event "notification").
class NotificationsSocket {
  io.Socket? _socket;

  void connect(String accessToken, void Function(Map<String, dynamic> notification) onNotification) {
    disconnect();
    _socket = io.io(
      Env.wsUrl,
      io.OptionBuilder().setTransports(['websocket']).setAuth({'token': accessToken}).disableAutoConnect().build(),
    )
      ..on('notification', (data) => onNotification(Map<String, dynamic>.from(data as Map)))
      ..connect();
  }

  void disconnect() {
    _socket?.dispose();
    _socket = null;
  }
}
