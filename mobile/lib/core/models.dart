import 'config/env.dart';

double _d(Object? v) => (v as num).toDouble();
DateTime _date(Object? v) => DateTime.parse(v as String).toLocal();

const orderStatuses = ['PENDING', 'CONFIRMED', 'SHIPPED', 'DELIVERED', 'CANCELLED'];

/// Mirrors the backend's allowed transitions (orders-service).
const nextStatuses = <String, List<String>>{
  'PENDING': ['CONFIRMED', 'CANCELLED'],
  'CONFIRMED': ['SHIPPED', 'CANCELLED'],
  'SHIPPED': ['DELIVERED'],
  'DELIVERED': [],
  'CANCELLED': [],
};

class Paged<T> {
  Paged(this.items, this.page, this.totalPages, this.total);

  final List<T> items;
  final int page;
  final int totalPages;
  final int total;

  factory Paged.fromJson(Map<String, dynamic> json, T Function(Map<String, dynamic>) item) {
    final meta = json['meta'] as Map<String, dynamic>;
    return Paged(
      (json['data'] as List).map((e) => item(e as Map<String, dynamic>)).toList(),
      meta['page'] as int,
      meta['totalPages'] as int,
      meta['total'] as int,
    );
  }
}

class User {
  User({required this.id, required this.email, required this.name, this.phone, required this.role});

  final String id;
  final String email;
  final String name;
  final String? phone;
  final String role;

  bool get isAdmin => role == 'ADMIN';

  factory User.fromJson(Map<String, dynamic> j) =>
      User(id: j['id'], email: j['email'], name: j['name'], phone: j['phone'], role: j['role']);
}

class Category {
  Category(this.id, this.name);

  final String id;
  final String name;

  factory Category.fromJson(Map<String, dynamic> j) => Category(j['id'], j['name']);
}

class Product {
  Product({
    required this.id,
    required this.name,
    required this.description,
    required this.price,
    required this.stock,
    required this.isActive,
    this.category,
    required this.images,
  });

  final String id;
  final String name;
  final String description;
  final double price;
  final int stock;
  final bool isActive;
  final Category? category;
  final List<String> images;

  String? get image => images.isEmpty ? null : images.first;

  factory Product.fromJson(Map<String, dynamic> j) => Product(
        id: j['id'],
        name: j['name'],
        description: j['description'] ?? '',
        price: _d(j['price']),
        stock: j['stock'] as int,
        isActive: j['isActive'] as bool? ?? true,
        category: j['category'] == null ? null : Category.fromJson(j['category']),
        images: (j['images'] as List? ?? []).map((i) => Env.fixUrl(i['url'] as String)).toList(),
      );
}

class OrderItem {
  OrderItem(this.productId, this.productName, this.unitPrice, this.quantity, this.subtotal);

  final String productId;
  final String productName;
  final double unitPrice;
  final int quantity;
  final double subtotal;

  factory OrderItem.fromJson(Map<String, dynamic> j) =>
      OrderItem(j['productId'], j['productName'], _d(j['unitPrice']), j['quantity'] as int, _d(j['subtotal']));
}

class OrderHistory {
  OrderHistory(this.status, this.note, this.createdAt);

  final String status;
  final String? note;
  final DateTime createdAt;

  factory OrderHistory.fromJson(Map<String, dynamic> j) => OrderHistory(j['status'], j['note'], _date(j['createdAt']));
}

class Order {
  Order({
    required this.id,
    required this.userId,
    required this.status,
    required this.total,
    required this.shippingAddress,
    this.note,
    required this.items,
    required this.history,
    required this.createdAt,
  });

  final String id;
  final String userId;
  final String status;
  final double total;
  final String shippingAddress;
  final String? note;
  final List<OrderItem> items;
  final List<OrderHistory> history;
  final DateTime createdAt;

  String get shortId => '#${id.substring(0, 8)}';
  int get itemCount => items.fold(0, (n, i) => n + i.quantity);

  factory Order.fromJson(Map<String, dynamic> j) => Order(
        id: j['id'],
        userId: j['userId'],
        status: j['status'],
        total: _d(j['total']),
        shippingAddress: j['shippingAddress'],
        note: j['note'],
        items: (j['items'] as List).map((e) => OrderItem.fromJson(e)).toList(),
        history: (j['history'] as List? ?? []).map((e) => OrderHistory.fromJson(e)).toList(),
        createdAt: _date(j['createdAt']),
      );
}

class AppNotification {
  AppNotification({
    required this.id,
    required this.type,
    required this.title,
    required this.body,
    required this.audience,
    this.readAt,
    required this.createdAt,
    this.data = const {},
  });

  final String id;
  final String type;
  final String title;
  final String body;
  final String audience;
  final DateTime? readAt;
  final DateTime createdAt;
  final Map<String, dynamic> data;

  bool get isRead => readAt != null;

  AppNotification markedRead() => AppNotification(
        id: id,
        type: type,
        title: title,
        body: body,
        audience: audience,
        readAt: readAt ?? DateTime.now(),
        createdAt: createdAt,
        data: data,
      );

  factory AppNotification.fromJson(Map<String, dynamic> j) => AppNotification(
        id: j['id'],
        type: j['type'],
        title: j['title'],
        body: j['body'],
        audience: j['audience'] ?? 'USER',
        readAt: j['readAt'] == null ? null : _date(j['readAt']),
        createdAt: _date(j['createdAt']),
        data: Map<String, dynamic>.from(j['data'] as Map? ?? {}),
      );
}
