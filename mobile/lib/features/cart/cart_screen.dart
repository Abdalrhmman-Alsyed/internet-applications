import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/i18n.dart';
import '../../core/network/api_client.dart';
import '../../core/widgets.dart';
import '../orders/order_details_screen.dart';
import 'cart_controller.dart';

class CartScreen extends StatefulWidget {
  const CartScreen({super.key});

  @override
  State<CartScreen> createState() => _CartScreenState();
}

class _CartScreenState extends State<CartScreen> {
  final _address = TextEditingController(text: 'Damascus, Mazzeh, Street 12');
  final _note = TextEditingController();
  bool _busy = false;

  Future<void> _checkout() async {
    if (_address.text.trim().length < 5) {
      showError(context.tr('cart.addressShort'));
      return;
    }
    setState(() => _busy = true);
    try {
      final order = await context.read<CartController>().checkout(address: _address.text, note: _note.text);
      if (!mounted) return;
      showSuccess(context.tr('cart.placed', {'id': order.shortId}));
      Navigator.push(context, MaterialPageRoute(builder: (_) => OrderDetailsScreen(order.id)));
    } on ApiException catch (e) {
      // e.g. 409 "Insufficient stock for ..." when someone bought the last unit first
      showError(e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final cart = context.watch<CartController>();
    return Scaffold(
      appBar: AppBar(
        title: Text(context.tr('cart.title')),
        actions: [if (!cart.isEmpty) TextButton(onPressed: cart.clear, child: Text(context.tr('clear')))],
      ),
      body: cart.isEmpty
          ? EmptyView(icon: Icons.shopping_cart_outlined, text: context.tr('cart.empty'))
          : ListView(
              padding: const EdgeInsets.all(12),
              children: [
                for (final line in cart.lines)
                  Card(
                    child: Padding(
                      padding: const EdgeInsets.all(8),
                      child: Row(
                        children: [
                          ProductImage(line.product.image, size: 64),
                          const SizedBox(width: 12),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(line.product.name, style: const TextStyle(fontWeight: FontWeight.w600)),
                                Text(context.tr('cart.each', {'price': money(line.product.price)}), style: TextStyle(color: Colors.grey.shade600, fontSize: 12)),
                                Text(money(line.subtotal), style: const TextStyle(fontWeight: FontWeight.bold)),
                              ],
                            ),
                          ),
                          IconButton(onPressed: () => cart.setQuantity(line.product.id, line.quantity - 1), icon: const Icon(Icons.remove_circle_outline)),
                          Text('${line.quantity}', style: Theme.of(context).textTheme.titleMedium),
                          IconButton(
                            onPressed: line.quantity < line.product.stock ? () => cart.setQuantity(line.product.id, line.quantity + 1) : null,
                            icon: const Icon(Icons.add_circle_outline),
                          ),
                        ],
                      ),
                    ),
                  ),
                const SizedBox(height: 12),
                TextField(
                  controller: _address,
                  decoration: InputDecoration(labelText: context.tr('cart.address'), prefixIcon: const Icon(Icons.location_on_outlined), border: const OutlineInputBorder()),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: _note,
                  decoration: InputDecoration(labelText: context.tr('cart.note'), prefixIcon: const Icon(Icons.note_outlined), border: const OutlineInputBorder()),
                ),
              ],
            ),
      bottomNavigationBar: cart.isEmpty
          ? null
          : SafeArea(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Row(
                  children: [
                    Column(
                      mainAxisSize: MainAxisSize.min,
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(context.tr('cart.items', {'n': cart.count}), style: TextStyle(color: Colors.grey.shade600)),
                        Text(money(cart.total), style: Theme.of(context).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.bold)),
                      ],
                    ),
                    const SizedBox(width: 16),
                    Expanded(
                      child: FilledButton(
                        onPressed: _busy ? null : _checkout,
                        style: FilledButton.styleFrom(padding: const EdgeInsets.symmetric(vertical: 14)),
                        child: _busy
                            ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2))
                            : Text(context.tr('cart.placeOrder')),
                      ),
                    ),
                  ],
                ),
              ),
            ),
    );
  }
}
