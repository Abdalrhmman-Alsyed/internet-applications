import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'admin/admin_dashboard_screen.dart';
import 'admin/inventory_screen.dart';
import 'cart/cart_controller.dart';
import 'cart/cart_screen.dart';
import 'notifications/notifications_controller.dart';
import 'notifications/notifications_screen.dart';
import 'orders/orders_screen.dart';
import 'products/products_screen.dart';
import 'profile/profile_screen.dart';

/// Bottom-navigation shell. The tabs depend on the role:
/// customers shop, admins manage. The server enforces the same split.
class AppShell extends StatefulWidget {
  const AppShell({super.key, required this.admin});

  final bool admin;

  @override
  State<AppShell> createState() => _AppShellState();
}

class _AppShellState extends State<AppShell> {
  int _index = 0;
  late final NotificationsController _notifications = context.read<NotificationsController>();

  @override
  void initState() {
    super.initState();
    _notifications.start();
  }

  @override
  void dispose() {
    _notifications.stop();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final unread = context.watch<NotificationsController>().unread;
    final cartCount = widget.admin ? 0 : context.watch<CartController>().count;

    final pages = widget.admin
        ? const [AdminDashboardScreen(), OrdersScreen(admin: true), InventoryScreen(), NotificationsScreen(), ProfileScreen()]
        : const [ProductsScreen(), CartScreen(), OrdersScreen(), NotificationsScreen(), ProfileScreen()];

    Widget badge(int n, IconData icon) => Badge(isLabelVisible: n > 0, label: Text('$n'), child: Icon(icon));

    final destinations = widget.admin
        ? [
            const NavigationDestination(icon: Icon(Icons.dashboard_outlined), label: 'Dashboard'),
            const NavigationDestination(icon: Icon(Icons.receipt_long_outlined), label: 'Orders'),
            const NavigationDestination(icon: Icon(Icons.inventory_2_outlined), label: 'Inventory'),
            NavigationDestination(icon: badge(unread, Icons.notifications_outlined), label: 'Alerts'),
            const NavigationDestination(icon: Icon(Icons.person_outline), label: 'Profile'),
          ]
        : [
            const NavigationDestination(icon: Icon(Icons.storefront_outlined), label: 'Shop'),
            NavigationDestination(icon: badge(cartCount, Icons.shopping_cart_outlined), label: 'Cart'),
            const NavigationDestination(icon: Icon(Icons.receipt_long_outlined), label: 'Orders'),
            NavigationDestination(icon: badge(unread, Icons.notifications_outlined), label: 'Alerts'),
            const NavigationDestination(icon: Icon(Icons.person_outline), label: 'Profile'),
          ];

    return Scaffold(
      body: IndexedStack(index: _index, children: pages),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _index,
        onDestinationSelected: (i) => setState(() => _index = i),
        destinations: destinations,
      ),
    );
  }
}
