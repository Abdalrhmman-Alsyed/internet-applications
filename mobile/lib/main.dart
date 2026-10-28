import 'package:flutter/material.dart';

import 'core/network/api_client.dart';
import 'core/storage/token_storage.dart';

void main() {
  runApp(const EcommerceApp());
}

class EcommerceApp extends StatelessWidget {
  const EcommerceApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'E-Commerce',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(colorSchemeSeed: Colors.indigo, useMaterial3: true),
      home: const HealthScreen(),
    );
  }
}

/// Placeholder screen: proves the app reaches the API Gateway.
/// Feature screens go under `lib/features/<feature>/`.
class HealthScreen extends StatefulWidget {
  const HealthScreen({super.key});

  @override
  State<HealthScreen> createState() => _HealthScreenState();
}

class _HealthScreenState extends State<HealthScreen> {
  final _api = ApiClient(TokenStorage());
  late Future<Map<String, dynamic>> _health = _load();

  Future<Map<String, dynamic>> _load() => _api.get<Map<String, dynamic>>('/health');

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('E-Commerce')),
      body: RefreshIndicator(
        onRefresh: () async => setState(() => _health = _load()),
        child: FutureBuilder<Map<String, dynamic>>(
          future: _health,
          builder: (context, snapshot) {
            if (snapshot.connectionState != ConnectionState.done) {
              return const Center(child: CircularProgressIndicator());
            }
            if (snapshot.hasError) {
              return ListView(children: [
                ListTile(
                  leading: const Icon(Icons.error, color: Colors.red),
                  title: Text('${snapshot.error}'),
                  subtitle: const Text('Is `docker compose up` running?'),
                ),
              ]);
            }
            final services = Map<String, dynamic>.from(snapshot.data!['services'] as Map);
            return ListView(
              children: services.entries.map((e) {
                final up = (e.value as Map)['status'] == 'up';
                return ListTile(
                  leading: Icon(Icons.circle, color: up ? Colors.green : Colors.red, size: 14),
                  title: Text(e.key),
                  trailing: Text(up ? 'up' : 'down'),
                );
              }).toList(),
            );
          },
        ),
      ),
    );
  }
}
