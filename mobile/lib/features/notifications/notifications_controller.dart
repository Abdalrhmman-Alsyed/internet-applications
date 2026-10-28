import 'package:flutter/material.dart';

import '../../core/models.dart';
import '../../core/network/api_client.dart';
import '../../core/realtime/notifications_socket.dart';
import '../../core/widgets.dart';

/// Notification list + unread badge, kept live through Socket.io.
class NotificationsController extends ChangeNotifier {
  NotificationsController(this.api);

  final ApiClient api;
  final _socket = NotificationsSocket();

  List<AppNotification> items = [];
  int unread = 0;
  bool loading = false;
  Object? error;

  /// Increments on every live notification, so screens can refresh themselves.
  int liveCount = 0;

  Future<void> start() async {
    await load();
    final token = await api.tokens.accessToken;
    if (token == null) return;
    _socket.connect(token, (json) {
      final n = AppNotification.fromJson(json);
      items = [n, ...items];
      unread++;
      liveCount++;
      notifyListeners();
      messengerKey.currentState?.showSnackBar(
        SnackBar(
          behavior: SnackBarBehavior.floating,
          content: Row(children: [
            const Icon(Icons.notifications_active, color: Colors.white),
            const SizedBox(width: 10),
            Expanded(child: Text('${n.title}\n${n.body}')),
          ]),
        ),
      );
    });
  }

  void stop() {
    _socket.disconnect();
    items = [];
    unread = 0;
  }

  Future<void> load() async {
    loading = true;
    notifyListeners();
    try {
      final res = await api.get<Map<String, dynamic>>('/notifications', query: {'limit': 50});
      items = Paged.fromJson(res, AppNotification.fromJson).items;
      unread = res['unread'] as int? ?? 0;
      error = null;
    } catch (e) {
      error = e;
    } finally {
      loading = false;
      notifyListeners();
    }
  }

  Future<void> markRead(AppNotification n) async {
    if (n.isRead) return;
    await api.patch('/notifications/${n.id}/read');
    items = [for (final x in items) x.id == n.id ? x.markedRead() : x];
    unread = (unread - 1).clamp(0, 1 << 30);
    notifyListeners();
  }

  Future<void> markAllRead() async {
    await api.patch('/notifications/read-all');
    items = [for (final x in items) x.markedRead()];
    unread = 0;
    notifyListeners();
  }

  @override
  void dispose() {
    _socket.disconnect();
    super.dispose();
  }
}
