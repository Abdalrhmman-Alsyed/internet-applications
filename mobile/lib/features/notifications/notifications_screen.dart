import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/i18n.dart';
import '../../core/models.dart';
import '../../core/widgets.dart';
import 'notifications_controller.dart';

IconData _icon(String type) => switch (type) {
      'order.created' => Icons.receipt_long,
      'order.status_changed' => Icons.local_shipping,
      'product.low_stock' => Icons.warning_amber,
      'user.registered' => Icons.waving_hand,
      _ => Icons.notifications,
    };

class NotificationsScreen extends StatelessWidget {
  const NotificationsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final c = context.watch<NotificationsController>();
    return Scaffold(
      appBar: AppBar(
        title: Text(context.tr('notifications.title')),
        actions: [
          if (c.unread > 0) TextButton(onPressed: () => c.markAllRead().catchError(showError), child: Text(context.tr('notifications.markAll'))),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: c.load,
        child: c.error != null && c.items.isEmpty
            ? ListView(children: [SizedBox(height: 400, child: ErrorView(c.error!, onRetry: c.load))])
            : c.items.isEmpty
                ? ListView(children: [
                    const SizedBox(height: 160),
                    c.loading
                        ? const Center(child: CircularProgressIndicator())
                        : EmptyView(icon: Icons.notifications_none, text: context.tr('notifications.empty')),
                  ])
                : ListView.separated(
                    itemCount: c.items.length,
                    separatorBuilder: (_, __) => const Divider(height: 1),
                    itemBuilder: (_, i) => _Tile(c.items[i]),
                  ),
      ),
    );
  }
}

class _Tile extends StatelessWidget {
  const _Tile(this.n);

  final AppNotification n;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final (title, body) = localizeNotification(context, n);
    return ListTile(
      tileColor: n.isRead ? null : scheme.primaryContainer.withValues(alpha: 0.25),
      leading: CircleAvatar(backgroundColor: scheme.primaryContainer, child: Icon(_icon(n.type), color: scheme.primary)),
      title: Text(title, style: TextStyle(fontWeight: n.isRead ? FontWeight.normal : FontWeight.bold)),
      subtitle: Text('$body\n${formatDate(n.createdAt)}${n.audience == 'ADMINS' ? ' · ${context.tr('notifications.allAdmins')}' : ''}'),
      isThreeLine: true,
      onTap: () => context.read<NotificationsController>().markRead(n).catchError(showError),
    );
  }
}
