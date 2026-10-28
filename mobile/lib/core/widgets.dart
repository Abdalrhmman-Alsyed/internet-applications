import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import 'i18n.dart';
import 'network/api_client.dart';

String money(double v) => '\$${v.toStringAsFixed(2)}';
String formatDate(DateTime d) => DateFormat('d MMM, HH:mm').format(d);

/// Global messenger so services (e.g. live notifications) can show snackbars.
final messengerKey = GlobalKey<ScaffoldMessengerState>();

void showError(Object error) {
  final text = error is ApiException ? '${error.statusCode} · ${error.message}' : '$error';
  messengerKey.currentState?.showSnackBar(
    SnackBar(content: Text(text), backgroundColor: Colors.red.shade700, behavior: SnackBarBehavior.floating),
  );
}

void showSuccess(String text) {
  messengerKey.currentState?.showSnackBar(
    SnackBar(content: Text(text), backgroundColor: Colors.green.shade700, behavior: SnackBarBehavior.floating),
  );
}

Color statusColor(String status) => switch (status) {
      'PENDING' => Colors.orange,
      'CONFIRMED' => Colors.blue,
      'SHIPPED' => Colors.indigo,
      'DELIVERED' => Colors.green,
      'CANCELLED' => Colors.red,
      _ => Colors.grey,
    };

IconData statusIcon(String status) => switch (status) {
      'PENDING' => Icons.hourglass_top,
      'CONFIRMED' => Icons.thumb_up_alt_outlined,
      'SHIPPED' => Icons.local_shipping_outlined,
      'DELIVERED' => Icons.check_circle_outline,
      'CANCELLED' => Icons.cancel_outlined,
      _ => Icons.help_outline,
    };

class StatusChip extends StatelessWidget {
  const StatusChip(this.status, {super.key});

  final String status;

  @override
  Widget build(BuildContext context) {
    final color = statusColor(status);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(color: color.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(20)),
      child: Text(context.status(status), style: TextStyle(color: color, fontSize: 11, fontWeight: FontWeight.w600)),
    );
  }
}

class ErrorView extends StatelessWidget {
  const ErrorView(this.error, {super.key, this.onRetry});

  final Object error;
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) {
    final e = error is ApiException ? error as ApiException : null;
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(e?.statusCode == 403 ? Icons.block : Icons.cloud_off, size: 48, color: Colors.red.shade300),
            const SizedBox(height: 12),
            Text(e != null ? '${e.statusCode} ${e.error ?? ''}' : context.tr('error'), style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 4),
            Text(e?.message ?? '$error', textAlign: TextAlign.center),
            if (onRetry != null) ...[
              const SizedBox(height: 16),
              OutlinedButton.icon(onPressed: onRetry, icon: const Icon(Icons.refresh), label: Text(context.tr('retry'))),
            ],
          ],
        ),
      ),
    );
  }
}

class ProductImage extends StatelessWidget {
  const ProductImage(this.url, {super.key, this.size, this.radius = 12});

  final String? url;
  final double? size;
  final double radius;

  @override
  Widget build(BuildContext context) {
    final placeholder = Container(
      width: size,
      height: size,
      color: Colors.grey.shade200,
      child: const Icon(Icons.image_outlined, color: Colors.grey),
    );
    return ClipRRect(
      borderRadius: BorderRadius.circular(radius),
      child: url == null
          ? placeholder
          : Image.network(url!, width: size, height: size, fit: BoxFit.cover, errorBuilder: (_, __, ___) => placeholder),
    );
  }
}

class EmptyView extends StatelessWidget {
  const EmptyView({super.key, required this.icon, required this.text});

  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 56, color: Colors.grey.shade400),
          const SizedBox(height: 12),
          Text(text, style: TextStyle(color: Colors.grey.shade600)),
        ],
      ),
    );
  }
}
