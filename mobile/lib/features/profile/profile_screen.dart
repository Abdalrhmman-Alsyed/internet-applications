import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/config/env.dart';
import '../../core/widgets.dart';
import '../auth/auth_controller.dart';
import '../security/security_test_screen.dart';

class ProfileScreen extends StatelessWidget {
  const ProfileScreen({super.key});

  Future<void> _edit(BuildContext context) async {
    final auth = context.read<AuthController>();
    final name = TextEditingController(text: auth.user!.name);
    final phone = TextEditingController(text: auth.user!.phone ?? '');
    final saved = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Edit profile'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(controller: name, decoration: const InputDecoration(labelText: 'Name')),
            TextField(controller: phone, decoration: const InputDecoration(labelText: 'Phone'), keyboardType: TextInputType.phone),
          ],
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Save')),
        ],
      ),
    );
    if (saved != true) return;
    try {
      await auth.updateProfile(name: name.text, phone: phone.text);
      showSuccess('Profile updated');
    } catch (e) {
      showError(e);
    }
  }

  @override
  Widget build(BuildContext context) {
    final user = context.watch<AuthController>().user!;
    final scheme = Theme.of(context).colorScheme;
    return Scaffold(
      appBar: AppBar(title: const Text('Profile')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Center(
            child: CircleAvatar(
              radius: 40,
              backgroundColor: scheme.primaryContainer,
              child: Text(user.name.characters.first.toUpperCase(), style: TextStyle(fontSize: 32, color: scheme.primary)),
            ),
          ),
          const SizedBox(height: 12),
          Center(child: Text(user.name, style: Theme.of(context).textTheme.titleLarge)),
          Center(child: Text(user.email, style: TextStyle(color: Colors.grey.shade600))),
          const SizedBox(height: 8),
          Center(
            child: Chip(
              avatar: Icon(user.isAdmin ? Icons.admin_panel_settings : Icons.person, size: 18),
              label: Text(user.role),
              backgroundColor: user.isAdmin ? Colors.indigo.shade50 : null,
            ),
          ),
          const SizedBox(height: 16),
          Card(
            child: Column(
              children: [
                ListTile(leading: const Icon(Icons.phone_outlined), title: const Text('Phone'), subtitle: Text(user.phone ?? 'Not set')),
                const Divider(height: 1),
                ListTile(leading: const Icon(Icons.edit_outlined), title: const Text('Edit profile'), trailing: const Icon(Icons.chevron_right), onTap: () => _edit(context)),
              ],
            ),
          ),
          Card(
            color: Colors.red.shade50,
            child: ListTile(
              leading: Icon(Icons.shield_outlined, color: Colors.red.shade700),
              title: const Text('Security test'),
              subtitle: const Text('Try actions outside your permissions and see the server reject them'),
              trailing: const Icon(Icons.chevron_right),
              onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const SecurityTestScreen())),
            ),
          ),
          Card(
            child: ListTile(
              leading: const Icon(Icons.dns_outlined),
              title: const Text('Server'),
              subtitle: Text(Env.apiBase),
            ),
          ),
          const SizedBox(height: 16),
          OutlinedButton.icon(
            onPressed: () => context.read<AuthController>().logout(),
            icon: const Icon(Icons.logout),
            label: const Text('Sign out'),
            style: OutlinedButton.styleFrom(padding: const EdgeInsets.symmetric(vertical: 12)),
          ),
        ],
      ),
    );
  }
}
