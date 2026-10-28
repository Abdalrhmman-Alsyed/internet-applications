import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/config/env.dart';
import '../../core/i18n.dart';
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
        title: Text(context.tr('profile.edit')),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(controller: name, decoration: InputDecoration(labelText: context.tr('name'))),
            TextField(controller: phone, decoration: InputDecoration(labelText: context.tr('phone')), keyboardType: TextInputType.phone),
          ],
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: Text(context.tr('cancel'))),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: Text(context.tr('save'))),
        ],
      ),
    );
    if (saved != true || !context.mounted) return;
    final done = context.tr('profile.updated');
    try {
      await auth.updateProfile(name: name.text, phone: phone.text);
      showSuccess(done);
    } catch (e) {
      showError(e);
    }
  }

  @override
  Widget build(BuildContext context) {
    final user = context.watch<AuthController>().user!;
    final scheme = Theme.of(context).colorScheme;
    return Scaffold(
      appBar: AppBar(title: Text(context.tr('profile.title')), actions: const [LanguageButton()]),
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
              label: Text(context.role(user.role)),
              backgroundColor: user.isAdmin ? Colors.indigo.shade50 : null,
            ),
          ),
          const SizedBox(height: 16),
          Card(
            child: Column(
              children: [
                ListTile(leading: const Icon(Icons.phone_outlined), title: Text(context.tr('phone')), subtitle: Text(user.phone ?? context.tr('notSet'))),
                const Divider(height: 1),
                ListTile(leading: const Icon(Icons.edit_outlined), title: Text(context.tr('profile.edit')), trailing: const Icon(Icons.chevron_right), onTap: () => _edit(context)),
              ],
            ),
          ),
          Card(
            color: Colors.red.shade50,
            child: ListTile(
              leading: Icon(Icons.shield_outlined, color: Colors.red.shade700),
              title: Text(context.tr('security.entry')),
              subtitle: Text(context.tr('security.entrySub')),
              trailing: const Icon(Icons.chevron_right),
              onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const SecurityTestScreen())),
            ),
          ),
          Card(
            child: ListTile(
              leading: const Icon(Icons.translate),
              title: Text(context.tr('language')),
              trailing: SegmentedButton<String>(
                segments: const [ButtonSegment(value: 'en', label: Text('English')), ButtonSegment(value: 'ar', label: Text('العربية'))],
                selected: {context.watch<LocaleController>().locale.languageCode},
                onSelectionChanged: (s) => context.read<LocaleController>().set(s.first),
                showSelectedIcon: false,
              ),
            ),
          ),
          Card(
            child: ListTile(
              leading: const Icon(Icons.dns_outlined),
              title: Text(context.tr('server')),
              subtitle: Text(Env.apiBase),
            ),
          ),
          const SizedBox(height: 16),
          OutlinedButton.icon(
            onPressed: () => context.read<AuthController>().logout(),
            icon: const Icon(Icons.logout),
            label: Text(context.tr('signOut')),
            style: OutlinedButton.styleFrom(padding: const EdgeInsets.symmetric(vertical: 12)),
          ),
        ],
      ),
    );
  }
}
