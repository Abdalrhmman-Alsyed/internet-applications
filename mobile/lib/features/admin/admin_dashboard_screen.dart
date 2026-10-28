import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/models.dart';
import '../../core/network/api_client.dart';
import '../../core/widgets.dart';
import '../notifications/notifications_controller.dart';

class AdminDashboardScreen extends StatefulWidget {
  const AdminDashboardScreen({super.key});

  @override
  State<AdminDashboardScreen> createState() => _AdminDashboardScreenState();
}

class _AdminDashboardScreenState extends State<AdminDashboardScreen> {
  late Future<(Map<String, dynamic>, List<Product>)> _future = _load();
  int _seenBump = 0;

  Future<(Map<String, dynamic>, List<Product>)> _load() async {
    final api = context.read<ApiClient>();
    final results = await Future.wait([
      api.get<Map<String, dynamic>>('/orders/stats'),
      api.get<Map<String, dynamic>>('/products', query: {'maxStock': 5, 'limit': 20, 'sort': 'name'}),
    ]);
    return (results[0], Paged.fromJson(results[1], Product.fromJson).items);
  }

  void _refresh() => setState(() { _future = _load(); });

  @override
  Widget build(BuildContext context) {
    final bump = context.watch<NotificationsController>().liveCount;
    if (bump != _seenBump) {
      _seenBump = bump;
      WidgetsBinding.instance.addPostFrameCallback((_) => _refresh());
    }
    return Scaffold(
      appBar: AppBar(title: const Text('Dashboard')),
      body: RefreshIndicator(
        onRefresh: () async => _refresh(),
        child: FutureBuilder(
          future: _future,
          builder: (context, snap) {
            if (snap.hasError) return ListView(children: [SizedBox(height: 400, child: ErrorView(snap.error!, onRetry: _refresh))]);
            if (!snap.hasData) return const Center(child: CircularProgressIndicator());
            final (stats, lowStock) = snap.data!;
            final byStatus = Map<String, dynamic>.from(stats['byStatus'] as Map);
            final total = stats['totalOrders'] as int;
            return ListView(
              padding: const EdgeInsets.all(12),
              children: [
                Row(
                  children: [
                    Expanded(child: _Kpi('Revenue', money((stats['revenue'] as num).toDouble()), Icons.payments_outlined, Colors.green)),
                    const SizedBox(width: 8),
                    Expanded(child: _Kpi('Orders', '$total', Icons.receipt_long_outlined, Colors.indigo)),
                    const SizedBox(width: 8),
                    Expanded(child: _Kpi('Pending', '${byStatus['PENDING']}', Icons.hourglass_top, Colors.orange)),
                  ],
                ),
                const SizedBox(height: 12),
                Card(
                  child: Padding(
                    padding: const EdgeInsets.all(16),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('Orders by status', style: Theme.of(context).textTheme.titleMedium),
                        const SizedBox(height: 12),
                        for (final s in orderStatuses) ...[
                          Row(children: [StatusChip(s), const Spacer(), Text('${byStatus[s]}', style: const TextStyle(fontWeight: FontWeight.bold))]),
                          const SizedBox(height: 4),
                          LinearProgressIndicator(
                            value: total == 0 ? 0 : (byStatus[s] as int) / total,
                            color: statusColor(s),
                            backgroundColor: statusColor(s).withValues(alpha: 0.1),
                            minHeight: 6,
                            borderRadius: BorderRadius.circular(3),
                          ),
                          const SizedBox(height: 10),
                        ],
                      ],
                    ),
                  ),
                ),
                Card(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Padding(
                        padding: const EdgeInsets.fromLTRB(16, 16, 16, 4),
                        child: Text('Low stock (≤ 5)', style: Theme.of(context).textTheme.titleMedium),
                      ),
                      if (lowStock.isEmpty) const ListTile(title: Text('All products are well stocked')),
                      for (final p in lowStock)
                        ListTile(
                          leading: ProductImage(p.image, size: 40, radius: 8),
                          title: Text(p.name),
                          trailing: Text('${p.stock} left', style: TextStyle(color: p.stock == 0 ? Colors.red : Colors.orange, fontWeight: FontWeight.bold)),
                        ),
                    ],
                  ),
                ),
              ],
            );
          },
        ),
      ),
    );
  }
}

class _Kpi extends StatelessWidget {
  const _Kpi(this.label, this.value, this.icon, this.color);

  final String label;
  final String value;
  final IconData icon;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(icon, color: color),
            const SizedBox(height: 8),
            FittedBox(child: Text(value, style: Theme.of(context).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.bold))),
            Text(label, style: TextStyle(color: Colors.grey.shade600, fontSize: 12)),
          ],
        ),
      ),
    );
  }
}
