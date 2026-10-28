import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/i18n.dart';
import '../../core/models.dart';
import '../../core/network/api_client.dart';
import '../../core/widgets.dart';
import '../notifications/notifications_controller.dart';
import 'order_details_screen.dart';

/// Customers see their own orders (enforced by the server); admins see all, with a status filter.
class OrdersScreen extends StatefulWidget {
  const OrdersScreen({super.key, this.admin = false});

  final bool admin;

  @override
  State<OrdersScreen> createState() => _OrdersScreenState();
}

class _OrdersScreenState extends State<OrdersScreen> {
  String? _status;
  late Future<List<Order>> _future = _load();
  int _seenBump = 0;

  Future<List<Order>> _load() async {
    final res = await context.read<ApiClient>().get<Map<String, dynamic>>('/orders', query: {
      'limit': 50,
      if (_status != null) 'status': _status,
    });
    return Paged.fromJson(res, Order.fromJson).items;
  }

  void _refresh() => setState(() { _future = _load(); });

  @override
  Widget build(BuildContext context) {
    // A live notification (new order / status change) refreshes the list.
    final bump = context.watch<NotificationsController>().liveCount;
    if (bump != _seenBump) {
      _seenBump = bump;
      WidgetsBinding.instance.addPostFrameCallback((_) => _refresh());
    }

    return Scaffold(
      appBar: AppBar(
        title: Text(context.tr(widget.admin ? 'orders.all' : 'orders.mine')),
        bottom: widget.admin
            ? PreferredSize(
                preferredSize: const Size.fromHeight(48),
                child: SizedBox(
                  height: 48,
                  child: ListView(
                    scrollDirection: Axis.horizontal,
                    padding: const EdgeInsets.symmetric(horizontal: 12),
                    children: [
                      for (final s in [null, ...orderStatuses])
                        Padding(
                          padding: const EdgeInsets.symmetric(horizontal: 4),
                          child: ChoiceChip(
                            label: Text(s == null ? context.tr('all') : context.status(s)),
                            selected: _status == s,
                            onSelected: (_) {
                              _status = s;
                              _refresh();
                            },
                          ),
                        ),
                    ],
                  ),
                ),
              )
            : null,
      ),
      body: RefreshIndicator(
        onRefresh: () async => _refresh(),
        child: FutureBuilder<List<Order>>(
          future: _future,
          builder: (context, snap) {
            if (snap.hasError) return ListView(children: [SizedBox(height: 400, child: ErrorView(snap.error!, onRetry: _refresh))]);
            if (!snap.hasData) return const Center(child: CircularProgressIndicator());
            final orders = snap.data!;
            if (orders.isEmpty) {
              return ListView(children: [const SizedBox(height: 160), EmptyView(icon: Icons.receipt_long_outlined, text: context.tr('orders.empty'))]);
            }
            return ListView.separated(
              padding: const EdgeInsets.all(12),
              itemCount: orders.length,
              separatorBuilder: (_, __) => const SizedBox(height: 8),
              itemBuilder: (_, i) {
                final o = orders[i];
                return Card(
                  child: ListTile(
                    leading: CircleAvatar(
                      backgroundColor: statusColor(o.status).withValues(alpha: 0.15),
                      child: Icon(statusIcon(o.status), color: statusColor(o.status)),
                    ),
                    title: Row(
                      children: [
                        Text(o.shortId, style: const TextStyle(fontWeight: FontWeight.w600, fontFamily: 'monospace')),
                        const Spacer(),
                        StatusChip(o.status),
                      ],
                    ),
                    subtitle: Text('${context.tr('orders.summary', {'n': o.itemCount, 'total': money(o.total)})}\n${formatDate(o.createdAt)}'),
                    isThreeLine: true,
                    onTap: () async {
                      await Navigator.push(context, MaterialPageRoute(builder: (_) => OrderDetailsScreen(o.id, admin: widget.admin)));
                      _refresh();
                    },
                  ),
                );
              },
            );
          },
        ),
      ),
    );
  }
}
