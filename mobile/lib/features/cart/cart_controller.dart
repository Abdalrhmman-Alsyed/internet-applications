import 'package:flutter/foundation.dart';

import '../../core/models.dart';
import '../../core/network/api_client.dart';

class CartLine {
  CartLine(this.product, this.quantity);

  final Product product;
  int quantity;

  double get subtotal => product.price * quantity;
}

/// Local cart. Prices shown here are a preview: the server recomputes them when ordering.
class CartController extends ChangeNotifier {
  CartController(this.api);

  final ApiClient api;
  final Map<String, CartLine> _lines = {};

  List<CartLine> get lines => _lines.values.toList();
  int get count => _lines.values.fold(0, (n, l) => n + l.quantity);
  double get total => _lines.values.fold(0, (s, l) => s + l.subtotal);
  bool get isEmpty => _lines.isEmpty;

  int quantityOf(String productId) => _lines[productId]?.quantity ?? 0;

  void add(Product product, [int quantity = 1]) {
    final line = _lines.putIfAbsent(product.id, () => CartLine(product, 0));
    line.quantity = (line.quantity + quantity).clamp(1, product.stock);
    notifyListeners();
  }

  void setQuantity(String productId, int quantity) {
    final line = _lines[productId];
    if (line == null) return;
    if (quantity <= 0) {
      _lines.remove(productId);
    } else {
      line.quantity = quantity.clamp(1, line.product.stock);
    }
    notifyListeners();
  }

  void clear() {
    _lines.clear();
    notifyListeners();
  }

  /// Places the order. Stock is reserved atomically by the backend (409 if not enough).
  Future<Order> checkout({required String address, String? note}) async {
    final res = await api.post<Map<String, dynamic>>('/orders', data: {
      'items': [for (final l in _lines.values) {'productId': l.product.id, 'quantity': l.quantity}],
      'shippingAddress': address.trim(),
      if (note != null && note.trim().isNotEmpty) 'note': note.trim(),
    });
    clear();
    return Order.fromJson(res);
  }
}
