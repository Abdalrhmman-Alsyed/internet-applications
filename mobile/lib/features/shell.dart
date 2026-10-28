import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../core/i18n.dart';
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
    // After the first frame: start() notifies listeners, which isn't allowed mid-build.
    WidgetsBinding.instance.addPostFrameCallback((_) => _notifications.start());
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
            NavigationDestination(icon: const Icon(Icons.dashboard_outlined), label: context.tr('nav.dashboard')),
            NavigationDestination(icon: const Icon(Icons.receipt_long_outlined), label: context.tr('nav.orders')),
            NavigationDestination(icon: const Icon(Icons.inventory_2_outlined), label: context.tr('nav.inventory')),
            NavigationDestination(icon: badge(unread, Icons.notifications_outlined), label: context.tr('nav.alerts')),
            NavigationDestination(icon: const Icon(Icons.person_outline), label: context.tr('nav.profile')),
          ]
        : [
            NavigationDestination(icon: const Icon(Icons.storefront_outlined), label: context.tr('nav.shop')),
            NavigationDestination(icon: badge(cartCount, Icons.shopping_cart_outlined), label: context.tr('nav.cart')),
            NavigationDestination(icon: const Icon(Icons.receipt_long_outlined), label: context.tr('nav.orders')),
            NavigationDestination(icon: badge(unread, Icons.notifications_outlined), label: context.tr('nav.alerts')),
            NavigationDestination(icon: const Icon(Icons.person_outline), label: context.tr('nav.profile')),
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
