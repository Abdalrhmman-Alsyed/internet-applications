import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/i18n.dart';
import '../../core/models.dart';
import '../../core/network/api_client.dart';
import '../../core/widgets.dart';
import '../cart/cart_controller.dart';

class ProductDetailsScreen extends StatefulWidget {
  const ProductDetailsScreen(this.initial, {super.key});

  final Product initial;

  @override
  State<ProductDetailsScreen> createState() => _ProductDetailsScreenState();
}

class _ProductDetailsScreenState extends State<ProductDetailsScreen> {
  late Product _product = widget.initial;
  int _qty = 1;
  int _imageIndex = 0;

  @override
  void initState() {
    super.initState();
    // Refresh: stock may have changed since the list was loaded.
    context.read<ApiClient>().get<Map<String, dynamic>>('/products/${_product.id}').then((p) {
      if (mounted) setState(() => _product = Product.fromJson(p));
    }).catchError((_) {});
  }

  @override
  Widget build(BuildContext context) {
    final p = _product;
    final theme = Theme.of(context);
    final inCart = context.watch<CartController>().quantityOf(p.id);
    final maxQty = p.stock - inCart;

    return Scaffold(
      appBar: AppBar(title: Text(p.name, overflow: TextOverflow.ellipsis)),
      body: ListView(
        children: [
          AspectRatio(
            aspectRatio: 1.2,
            child: p.images.isEmpty
                ? const ProductImage(null, radius: 0)
                : Stack(
                    children: [
                      PageView(
                        onPageChanged: (i) => setState(() => _imageIndex = i),
                        children: [for (final url in p.images) ProductImage(url, radius: 0)],
                      ),
                      if (p.images.length > 1)
                        Positioned(
                          bottom: 12,
                          left: 0,
                          right: 0,
                          child: Row(
                            mainAxisAlignment: MainAxisAlignment.center,
                            children: [
                              for (var i = 0; i < p.images.length; i++)
                                Container(
                                  margin: const EdgeInsets.all(3),
                                  width: 8,
                                  height: 8,
                                  decoration: BoxDecoration(shape: BoxShape.circle, color: i == _imageIndex ? Colors.white : Colors.white54),
                                ),
                            ],
                          ),
                        ),
                    ],
                  ),
          ),
          Padding(
            padding: const EdgeInsets.all(20),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                if (p.category != null) Chip(label: Text(p.category!.name), visualDensity: VisualDensity.compact),
                const SizedBox(height: 8),
                Text(p.name, style: theme.textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.bold)),
                const SizedBox(height: 8),
                Row(
                  children: [
                    Text(money(p.price), style: theme.textTheme.headlineSmall?.copyWith(color: theme.colorScheme.primary, fontWeight: FontWeight.bold)),
                    const Spacer(),
                    _StockLabel(p.stock),
                  ],
                ),
                const SizedBox(height: 16),
                Text(p.description.isEmpty ? context.tr('product.noDescription') : p.description, style: theme.textTheme.bodyLarge),
              ],
            ),
          ),
        ],
      ),
      bottomNavigationBar: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Row(
            children: [
              IconButton.outlined(onPressed: _qty > 1 ? () => setState(() => _qty--) : null, icon: const Icon(Icons.remove)),
              Padding(padding: const EdgeInsets.symmetric(horizontal: 16), child: Text('$_qty', style: theme.textTheme.titleLarge)),
              IconButton.outlined(onPressed: _qty < maxQty ? () => setState(() => _qty++) : null, icon: const Icon(Icons.add)),
              const SizedBox(width: 16),
              Expanded(
                child: FilledButton.icon(
                  style: FilledButton.styleFrom(padding: const EdgeInsets.symmetric(vertical: 14)),
                  onPressed: maxQty <= 0
                      ? null
                      : () {
                          context.read<CartController>().add(p, _qty);
                          showSuccess(context.tr('cart.addedQty', {'qty': _qty, 'name': p.name}));
                          Navigator.pop(context);
                        },
                  icon: const Icon(Icons.add_shopping_cart),
                  label: Text(p.stock == 0 ? context.tr('stock.out') : maxQty <= 0 ? context.tr('cart.allIn') : context.tr('cart.add')),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _StockLabel extends StatelessWidget {
  const _StockLabel(this.stock);

  final int stock;

  @override
  Widget build(BuildContext context) {
    final (color, text) = stock == 0
        ? (Colors.red, context.tr('stock.out'))
        : stock <= 5
            ? (Colors.orange, context.tr('stock.few', {'n': stock}))
            : (Colors.green, context.tr('stock.in', {'n': stock}));
    return Text(text, style: TextStyle(color: color, fontWeight: FontWeight.w600));
  }
}
