import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/models.dart';
import '../../core/network/api_client.dart';
import '../../core/widgets.dart';
import '../notifications/notifications_controller.dart';

class OrderDetailsScreen extends StatefulWidget {
  const OrderDetailsScreen(this.orderId, {super.key, this.admin = false});

  final String orderId;
  final bool admin;

  @override
  State<OrderDetailsScreen> createState() => _OrderDetailsScreenState();
}

class _OrderDetailsScreenState extends State<OrderDetailsScreen> {
  Order? _order;
  Object? _error;
  String? _busy;
  int _seenBump = 0;

  late final ApiClient _api = context.read<ApiClient>();

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final o = Order.fromJson(await _api.get<Map<String, dynamic>>('/orders/${widget.orderId}'));
      setState(() {
        _order = o;
        _error = null;
      });
    } catch (e) {
      setState(() => _error = e);
    }
  }

  Future<void> _act(String key, Future<Map<String, dynamic>> Function() call, String done) async {
    setState(() => _busy = key);
    try {
      final o = Order.fromJson(await call());
      setState(() => _order = o);
      showSuccess(done);
    } catch (e) {
      showError(e);
    } finally {
      if (mounted) setState(() => _busy = null);
    }
  }

  Future<void> _cancel() async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Cancel order?'),
        content: const Text('The items go back to stock.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Keep')),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Cancel order')),
        ],
      ),
    );
    if (ok == true) {
      await _act('cancel', () => _api.post<Map<String, dynamic>>('/orders/${widget.orderId}/cancel'), 'Order cancelled');
    }
  }

  @override
  Widget build(BuildContext context) {
    // Reload when a live notification is about this order (e.g. the admin changed its status).
    final notes = context.watch<NotificationsController>();
    if (notes.liveCount != _seenBump) {
      _seenBump = notes.liveCount;
      if (notes.items.isNotEmpty && notes.items.first.data['orderId'] == widget.orderId) {
        WidgetsBinding.instance.addPostFrameCallback((_) => _load());
      }
    }
    final o = _order;
    return Scaffold(
      appBar: AppBar(title: Text(o?.shortId ?? 'Order')),
      body: _error != null
          ? ErrorView(_error!, onRetry: _load)
          : o == null
              ? const Center(child: CircularProgressIndicator())
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView(
                    padding: const EdgeInsets.all(16),
                    children: [
                      Card(
                        child: Padding(
                          padding: const EdgeInsets.all(16),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Row(children: [Text('Status', style: TextStyle(color: Colors.grey.shade600)), const Spacer(), StatusChip(o.status)]),
                              const Divider(height: 24),
                              Row(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  const Icon(Icons.location_on_outlined, size: 18),
                                  const SizedBox(width: 6),
                                  Expanded(child: Text(o.shippingAddress)),
                                ],
                              ),
                              if (o.note != null) ...[const SizedBox(height: 6), Text('Note: ${o.note}', style: TextStyle(color: Colors.grey.shade700))],
                              const SizedBox(height: 6),
                              Text('Placed ${formatDate(o.createdAt)}', style: TextStyle(color: Colors.grey.shade600, fontSize: 12)),
                            ],
                          ),
                        ),
                      ),
                      const SizedBox(height: 8),
                      Card(
                        child: Column(
                          children: [
                            for (final i in o.items)
                              ListTile(
                                title: Text(i.productName),
                                subtitle: Text('${i.quantity} × ${money(i.unitPrice)}'),
                                trailing: Text(money(i.subtotal), style: const TextStyle(fontWeight: FontWeight.w600)),
                              ),
                            const Divider(height: 1),
                            ListTile(
                              title: const Text('Total', style: TextStyle(fontWeight: FontWeight.bold)),
                              trailing: Text(money(o.total), style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.bold)),
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(height: 16),
                      Text('Tracking', style: Theme.of(context).textTheme.titleMedium),
                      const SizedBox(height: 8),
                      _Timeline(o),
                      const SizedBox(height: 24),
                      ..._actions(o),
                    ],
                  ),
                ),
    );
  }

  List<Widget> _actions(Order o) {
    if (widget.admin) {
      return [
        for (final next in nextStatuses[o.status]!)
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: FilledButton.icon(
              style: FilledButton.styleFrom(
                backgroundColor: next == 'CANCELLED' ? Colors.red : null,
                padding: const EdgeInsets.symmetric(vertical: 12),
              ),
              onPressed: _busy != null
                  ? null
                  : () => _act(next, () => _api.patch<Map<String, dynamic>>('/orders/${o.id}/status', data: {'status': next}), 'Order → $next (customer notified)'),
              icon: Icon(statusIcon(next)),
              label: Text(next == 'CANCELLED' ? 'Cancel order' : 'Mark as $next'),
            ),
          ),
      ];
    }
    if (o.status == 'PENDING') {
      return [
        OutlinedButton.icon(
          style: OutlinedButton.styleFrom(foregroundColor: Colors.red, padding: const EdgeInsets.symmetric(vertical: 12)),
          onPressed: _busy != null ? null : _cancel,
          icon: const Icon(Icons.cancel_outlined),
          label: const Text('Cancel order'),
        ),
      ];
    }
    return [];
  }
}

class _Timeline extends StatelessWidget {
  const _Timeline(this.order);

  final Order order;

  @override
  Widget build(BuildContext context) {
    final reached = {for (final h in order.history) h.status: h};
    final steps = order.status == 'CANCELLED'
        ? [...order.history.map((h) => h.status)]
        : ['PENDING', 'CONFIRMED', 'SHIPPED', 'DELIVERED'];
    return Column(
      children: [
        for (var i = 0; i < steps.length; i++)
          IntrinsicHeight(
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Column(
                  children: [
                    Icon(
                      reached.containsKey(steps[i]) ? statusIcon(steps[i]) : Icons.radio_button_unchecked,
                      color: reached.containsKey(steps[i]) ? statusColor(steps[i]) : Colors.grey.shade400,
                    ),
                    if (i < steps.length - 1)
                      Expanded(child: Container(width: 2, color: reached.containsKey(steps[i + 1]) ? statusColor(steps[i + 1]) : Colors.grey.shade300)),
                  ],
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Padding(
                    padding: const EdgeInsets.only(bottom: 16),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(steps[i], style: TextStyle(fontWeight: FontWeight.w600, color: reached.containsKey(steps[i]) ? null : Colors.grey)),
                        if (reached[steps[i]] != null)
                          Text(
                            [formatDate(reached[steps[i]]!.createdAt), if (reached[steps[i]]!.note != null) reached[steps[i]]!.note!].join(' · '),
                            style: TextStyle(fontSize: 12, color: Colors.grey.shade600),
                          ),
                      ],
                    ),
                  ),
                ),
              ],
            ),
          ),
      ],
    );
  }
}
