import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';

import 'core/i18n.dart';
import 'core/network/api_client.dart';
import 'core/storage/token_storage.dart';
import 'core/widgets.dart';
import 'features/auth/auth_controller.dart';
import 'features/auth/login_screen.dart';
import 'features/cart/cart_controller.dart';
import 'features/notifications/notifications_controller.dart';
import 'features/shell.dart';

void main() {
  final api = ApiClient(TokenStorage());
  runApp(
    MultiProvider(
      providers: [
        Provider.value(value: api),
        ChangeNotifierProvider(create: (_) => LocaleController()..load()),
        ChangeNotifierProvider(create: (_) => AuthController(api)..restore()),
        ChangeNotifierProvider(create: (_) => CartController(api)),
        ChangeNotifierProvider(create: (_) => NotificationsController(api)),
      ],
      child: const EcommerceApp(),
    ),
  );
}

final navigatorKey = GlobalKey<NavigatorState>();

class EcommerceApp extends StatelessWidget {
  const EcommerceApp({super.key});

  @override
  Widget build(BuildContext context) {
    final locale = context.watch<LocaleController>().locale;
    Intl.defaultLocale = locale.languageCode;
    return MaterialApp(
      title: 'E-Commerce',
      locale: locale,
      supportedLocales: const [Locale('en'), Locale('ar')],
      localizationsDelegates: const [
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      debugShowCheckedModeBanner: false,
      navigatorKey: navigatorKey,
      scaffoldMessengerKey: messengerKey,
      theme: ThemeData(colorSchemeSeed: Colors.indigo, useMaterial3: true),
      home: const _AuthGate(),
    );
  }
}

/// Picks the root screen from the auth state: login, customer app or admin app.
class _AuthGate extends StatelessWidget {
  const _AuthGate();

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthController>();
    if (auth.loading) return const Scaffold(body: Center(child: CircularProgressIndicator()));

    final user = auth.user;
    if (user == null) {
      // Signed out (or session expired): drop any pushed screens and clear the cart.
      WidgetsBinding.instance.addPostFrameCallback((_) {
        navigatorKey.currentState?.popUntil((r) => r.isFirst);
        context.read<CartController>().clear();
      });
      return const LoginScreen();
    }
    // Keyed by user so switching accounts rebuilds the shell (and its socket).
    return AppShell(key: ValueKey(user.id), admin: user.isAdmin);
  }
}
