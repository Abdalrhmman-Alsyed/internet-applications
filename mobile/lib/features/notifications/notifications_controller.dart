import 'package:flutter/material.dart';

import '../../core/i18n.dart';
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
      final ctx = messengerKey.currentContext;
      final (title, body) = ctx == null ? (n.title, n.body) : localizeNotification(ctx, n);
      messengerKey.currentState?.showSnackBar(
        SnackBar(
          behavior: SnackBarBehavior.floating,
          content: Row(children: [
            const Icon(Icons.notifications_active, color: Colors.white),
            const SizedBox(width: 10),
            Expanded(child: Text('$title\n$body')),
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

/// Title and body in the app language, built from the notification's type and data.
/// Falls back to the server's English text for unknown types.
(String, String) localizeNotification(BuildContext context, AppNotification n) {
  final orderId = n.data['orderId'] as String?;
  final id = orderId == null ? '' : '#${orderId.substring(0, 8)}';
  switch (n.type) {
    case 'user.registered':
      return (context.tr('n.welcome.title'), context.tr('n.welcome.body'));
    case 'order.created':
      return n.audience == 'ADMINS'
          ? (context.tr('n.newOrder.title'), context.tr('n.newOrder.body', {'id': id}))
          : (context.tr('n.received.title'), context.tr('n.received.body', {'id': id}));
    case 'order.status_changed':
      return (context.tr('n.update.title'), context.tr('n.update.body', {'id': id, 'status': context.status('${n.data['to']}')}));
    case 'product.low_stock':
      final stock = n.data['stock'];
      final name = RegExp(r'"(.+)"').firstMatch(n.body)?.group(1) ?? '';
      return (context.tr(stock == 0 ? 'n.outOfStock.title' : 'n.lowStock.title'), '$name · ${context.tr('admin.left', {'n': stock})}');
    default:
      return (n.title, n.body);
  }
}
