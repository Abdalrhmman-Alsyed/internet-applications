import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/models.dart';
import '../../core/network/api_client.dart';
import '../auth/auth_controller.dart';

/// Sends real requests that try to cross permission boundaries with the
/// signed-in user's own token, and shows what the server answered.
/// The "victim" is another demo customer whose order we try to reach.

const _demoPassword = 'Customer@123';
const _forgedToken = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJoYWNrZXIiLCJyb2xlIjoiQURNSU4ifQ.forged-signature';

enum _As { me, none, forged, victim }

class _Ctx {
  _Ctx(this.me, this.victimToken, this.victimEmail, this.victimOrderId, this.victimNotificationId, this.productId);

  final String me;
  final String victimToken;
  final String victimEmail;
  final String victimOrderId;
  final String? victimNotificationId;
  final String productId;
}

class _Scenario {
  const _Scenario(this.title, this.method, this.path, this.as, this.expectCustomer, this.expectAdmin, this.why, {this.body});

  final String title;
  final String method;
  final String Function(_Ctx) path;
  final _As as;
  final Object? Function(_Ctx)? body;
  final int expectCustomer;

  /// null = not run for admins (it would really change data).
  final int? expectAdmin;
  final String why;
}

final _scenarios = <_Scenario>[
  _Scenario('Read orders without a token', 'GET', (_) => '/orders', _As.none, 401, 401, 'Every route needs a JWT.'),
  _Scenario('Use a forged ADMIN token', 'GET', (_) => '/users/me', _As.forged, 401, 401, 'Signature checked with the server secret.'),
  _Scenario('Register yourself as ADMIN', 'POST', (_) => '/auth/register', _As.none, 400, 400, 'Unknown field "role" is rejected.',
      body: (_) => {'email': 'evil.${DateTime.now().millisecondsSinceEpoch}@test.local', 'password': _demoPassword, 'name': 'Evil', 'role': 'ADMIN'}),
  _Scenario('Create a product', 'POST', (_) => '/products', _As.me, 403, null, 'Admin-only route.', body: (_) => {'name': 'Hacked', 'price': 1, 'stock': 999}),
  _Scenario('Mark the victim\'s order DELIVERED', 'PATCH', (c) => '/orders/${c.victimOrderId}/status', _As.me, 403, null, 'Only admins change status.',
      body: (_) => {'status': 'DELIVERED'}),
  _Scenario('List all users', 'GET', (_) => '/users?limit=1', _As.me, 403, 200, 'Admin-only route.'),
  _Scenario('Read sales statistics', 'GET', (_) => '/orders/stats', _As.me, 403, 200, 'Admin-only route.'),
  _Scenario('Read system information', 'GET', (_) => '/system/info', _As.me, 403, 200, 'Admin-only route.'),
  _Scenario('Open the victim\'s order', 'GET', (c) => '/orders/${c.victimOrderId}', _As.me, 403, 200, 'Owner or admin only.'),
  _Scenario('Cancel the victim\'s order', 'POST', (c) => '/orders/${c.victimOrderId}/cancel', _As.me, 403, null, 'Ownership checked first.'),
  _Scenario('Mark the victim\'s notification read', 'PATCH', (c) => '/notifications/${c.victimNotificationId}/read', _As.me, 403, 403,
      'Personal notifications belong to their owner.'),
  _Scenario('Order a negative quantity', 'POST', (_) => '/orders', _As.me, 400, 403, 'Validation (customers) / only customers order (admins).',
      body: (c) => {
            'items': [
              {'productId': c.productId, 'quantity': -5}
            ],
            'shippingAddress': 'Somewhere 1',
          }),
  _Scenario('Control: the victim opens their own order', 'GET', (c) => '/orders/${c.victimOrderId}', _As.victim, 200, 200, 'Allowed access still works.'),
];

class SecurityTestScreen extends StatefulWidget {
  const SecurityTestScreen({super.key});

  @override
  State<SecurityTestScreen> createState() => _SecurityTestScreenState();
}

class _SecurityTestScreenState extends State<SecurityTestScreen> {
  _Ctx? _ctx;
  String? _setupError;
  final Map<int, RawResult> _results = {};
  bool _running = false;

  late final ApiClient _api = context.read<ApiClient>();

  Future<_Ctx?> _setup() async {
    if (_ctx != null) return _ctx;
    final user = context.read<AuthController>().user!;
    final me = await _api.tokens.accessToken;
    final victimEmail = user.email == 'sara@shop.local' ? 'ahmad@shop.local' : 'sara@shop.local';
    final login = await _api.raw('POST', '/auth/login', data: {'email': victimEmail, 'password': _demoPassword});
    if (login.status != 200 || me == null) {
      setState(() => _setupError = 'Could not sign in the demo victim ($victimEmail): ${login.status}. Run "npm run seed" in backend/.');
      return null;
    }
    final victimToken = (login.body as Map)['accessToken'] as String;
    final orders = await _api.raw('GET', '/orders?limit=1', token: victimToken);
    final notes = await _api.raw('GET', '/notifications?limit=1', token: victimToken);
    final products = await _api.raw('GET', '/products?limit=1');
    final orderList = (orders.body as Map)['data'] as List;
    final productList = (products.body as Map)['data'] as List;
    if (orderList.isEmpty || productList.isEmpty) {
      setState(() => _setupError = 'The victim has no orders yet. Run "npm run seed" in backend/.');
      return null;
    }
    final noteList = (notes.body as Map)['data'] as List;
    _ctx = _Ctx(me, victimToken, victimEmail, orderList.first['id'], noteList.isEmpty ? null : noteList.first['id'], productList.first['id']);
    return _ctx;
  }

  Future<void> _runAll() async {
    setState(() {
      _running = true;
      _setupError = null;
      _results.clear();
    });
    final isAdmin = context.read<AuthController>().user!.isAdmin;
    final ctx = await _setup();
    if (ctx != null) {
      for (var i = 0; i < _scenarios.length; i++) {
        final s = _scenarios[i];
        if (isAdmin && s.expectAdmin == null) continue;
        final token = switch (s.as) { _As.me => ctx.me, _As.none => null, _As.forged => _forgedToken, _As.victim => ctx.victimToken };
        final r = await _api.raw(s.method, s.path(ctx), data: s.body?.call(ctx), token: token);
        if (!mounted) return;
        setState(() => _results[i] = r);
      }
    }
    if (mounted) setState(() => _running = false);
  }

  @override
  Widget build(BuildContext context) {
    final user = context.watch<AuthController>().user!;
    final ran = _results.entries.toList();
    final passed = ran.where((e) => e.value.status == _expected(e.key, user)).length;

    return Scaffold(
      appBar: AppBar(title: const Text('Security test')),
      body: ListView(
        padding: const EdgeInsets.all(12),
        children: [
          Card(
            color: user.isAdmin ? Colors.indigo.shade50 : Colors.blue.shade50,
            child: ListTile(
              leading: Icon(user.isAdmin ? Icons.admin_panel_settings : Icons.person),
              title: Text('You are ${user.email}'),
              subtitle: Text(
                'Role ${user.role}. Requests are sent with your own token. '
                '${_ctx != null ? 'Victim: ${_ctx!.victimEmail}, order #${_ctx!.victimOrderId.substring(0, 8)}' : 'The victim is another demo customer.'}',
              ),
            ),
          ),
          if (_setupError != null) Card(color: Colors.red.shade50, child: ListTile(title: Text(_setupError!))),
          if (ran.isNotEmpty)
            Card(
              color: passed == ran.length ? Colors.green.shade50 : Colors.red.shade50,
              child: ListTile(
                leading: Icon(passed == ran.length ? Icons.verified_user : Icons.gpp_bad, color: passed == ran.length ? Colors.green : Colors.red),
                title: Text('$passed / ${ran.length} behaved as expected'),
              ),
            ),
          for (var i = 0; i < _scenarios.length; i++) _tile(i, user),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: _running ? null : _runAll,
        icon: _running ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2)) : const Icon(Icons.play_arrow),
        label: Text(_running ? 'Running…' : 'Run all'),
      ),
    );
  }

  int? _expected(int i, User user) => user.isAdmin ? _scenarios[i].expectAdmin : _scenarios[i].expectCustomer;

  Widget _tile(int i, User user) {
    final s = _scenarios[i];
    final expected = _expected(i, user);
    final r = _results[i];
    final pass = r != null && r.status == expected;
    return Card(
      child: ExpansionTile(
        leading: r == null
            ? Icon(expected == null ? Icons.remove_circle_outline : Icons.circle_outlined, color: Colors.grey)
            : Icon(pass ? Icons.check_circle : Icons.cancel, color: pass ? Colors.green : Colors.red),
        title: Text(s.title, style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600)),
        subtitle: Text(
          expected == null
              ? 'Skipped for admins (would change real data)'
              : '${s.method} · expect $expected${r != null ? ' · got ${r.status} (${r.ms} ms)' : ''}\n${s.why}',
          style: const TextStyle(fontSize: 12),
        ),
        children: [
          if (r != null)
            Container(
              width: double.infinity,
              margin: const EdgeInsets.fromLTRB(12, 0, 12, 12),
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(color: const Color(0xFF0F172A), borderRadius: BorderRadius.circular(8)),
              child: Text(
                'HTTP ${r.status}\n${const JsonEncoder.withIndent('  ').convert(r.body)}',
                style: const TextStyle(color: Colors.white, fontFamily: 'monospace', fontSize: 11),
              ),
            ),
        ],
      ),
    );
  }
}
