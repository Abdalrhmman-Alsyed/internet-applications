import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/models.dart';
import '../../core/network/api_client.dart';
import '../../core/widgets.dart';

/// Admin: adjust stock and hide/restore products. Full catalogue editing lives on the web dashboard.
class InventoryScreen extends StatefulWidget {
  const InventoryScreen({super.key});

  @override
  State<InventoryScreen> createState() => _InventoryScreenState();
}

class _InventoryScreenState extends State<InventoryScreen> {
  late Future<List<Product>> _future = _load();
  final Set<String> _busy = {};

  late final ApiClient _api = context.read<ApiClient>();

  Future<List<Product>> _load() async {
    final res = await _api.get<Map<String, dynamic>>('/products', query: {'limit': 100, 'sort': 'name'});
    return Paged.fromJson(res, Product.fromJson).items;
  }

  void _refresh() => setState(() { _future = _load(); });

  Future<void> _adjust(Product p, int delta) async {
    setState(() => _busy.add(p.id));
    try {
      await _api.patch('/products/${p.id}/stock', data: {'delta': delta});
      _refresh();
    } catch (e) {
      showError(e);
    } finally {
      if (mounted) setState(() => _busy.remove(p.id));
    }
  }

  Future<void> _toggle(Product p) async {
    try {
      if (p.isActive) {
        await _api.delete('/products/${p.id}');
        showSuccess('${p.name} hidden from the store');
      } else {
        await _api.patch('/products/${p.id}', data: {'isActive': true});
        showSuccess('${p.name} restored');
      }
      _refresh();
    } catch (e) {
      showError(e);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Inventory')),
      body: RefreshIndicator(
        onRefresh: () async => _refresh(),
        child: FutureBuilder<List<Product>>(
          future: _future,
          builder: (context, snap) {
            if (snap.hasError) return ListView(children: [SizedBox(height: 400, child: ErrorView(snap.error!, onRetry: _refresh))]);
            if (!snap.hasData) return const Center(child: CircularProgressIndicator());
            final products = snap.data!;
            return ListView.separated(
              padding: const EdgeInsets.all(12),
              itemCount: products.length,
              separatorBuilder: (_, __) => const SizedBox(height: 6),
              itemBuilder: (_, i) {
                final p = products[i];
                final busy = _busy.contains(p.id);
                return Opacity(
                  opacity: p.isActive ? 1 : 0.5,
                  child: Card(
                    child: Padding(
                      padding: const EdgeInsets.all(8),
                      child: Row(
                        children: [
                          ProductImage(p.image, size: 52, radius: 8),
                          const SizedBox(width: 10),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(p.name, style: const TextStyle(fontWeight: FontWeight.w600)),
                                Text('${money(p.price)}${p.isActive ? '' : ' · hidden'}', style: TextStyle(fontSize: 12, color: Colors.grey.shade600)),
                              ],
                            ),
                          ),
                          IconButton(onPressed: busy || p.stock == 0 ? null : () => _adjust(p, -1), icon: const Icon(Icons.remove_circle_outline)),
                          SizedBox(
                            width: 34,
                            child: Text(
                              '${p.stock}',
                              textAlign: TextAlign.center,
                              style: TextStyle(fontWeight: FontWeight.bold, color: p.stock == 0 ? Colors.red : p.stock <= 5 ? Colors.orange : null),
                            ),
                          ),
                          IconButton(onPressed: busy ? null : () => _adjust(p, 5), icon: const Icon(Icons.add_circle_outline), tooltip: '+5'),
                          PopupMenuButton<String>(
                            onSelected: (_) => _toggle(p),
                            itemBuilder: (_) => [PopupMenuItem(value: 'toggle', child: Text(p.isActive ? 'Hide from store' : 'Restore'))],
                          ),
                        ],
                      ),
                    ),
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
