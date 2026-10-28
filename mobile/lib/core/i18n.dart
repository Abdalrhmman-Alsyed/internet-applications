import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// App language (English / Arabic), remembered between launches.
class LocaleController extends ChangeNotifier {
  static const _key = 'app.language';

  Locale _locale = const Locale('en');
  Locale get locale => _locale;
  bool get isArabic => _locale.languageCode == 'ar';

  Future<void> load() async {
    final prefs = await SharedPreferences.getInstance();
    final saved = prefs.getString(_key);
    if (saved != null && saved != _locale.languageCode) {
      _locale = Locale(saved);
      notifyListeners();
    }
  }

  Future<void> set(String languageCode) async {
    if (languageCode == _locale.languageCode) return;
    _locale = Locale(languageCode);
    notifyListeners();
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_key, languageCode);
  }

  Future<void> toggle() => set(isArabic ? 'en' : 'ar');
}

/// Switches between English and Arabic (the whole app flips to right-to-left).
class LanguageButton extends StatelessWidget {
  const LanguageButton({super.key});

  @override
  Widget build(BuildContext context) {
    return TextButton.icon(
      onPressed: () => context.read<LocaleController>().toggle(),
      icon: const Icon(Icons.translate),
      label: Text(context.tr('language.switch')),
    );
  }
}

extension Tr on BuildContext {
  bool get isArabic => Localizations.localeOf(this).languageCode == 'ar';

  /// Translated text for [key]; `{name}` placeholders are filled from [args].
  String tr(String key, [Map<String, Object?> args = const {}]) {
    var text = (isArabic ? _ar[key] : _en[key]) ?? _en[key] ?? key;
    args.forEach((k, v) => text = text.replaceAll('{$k}', '$v'));
    return text;
  }

  /// Order status shown to the user (the API value stays in English).
  String status(String s) => tr('status.$s');

  String role(String r) => tr('role.$r');
}

const _en = <String, String>{
  'app.title': 'E-Commerce',
  'language': 'Language',
  'language.switch': 'العربية',

  // Auth
  'login.welcome': 'Welcome back',
  'login.subtitle': 'Sign in to continue shopping',
  'email': 'Email',
  'email.invalid': 'Enter a valid email',
  'password': 'Password',
  'password.required': 'Enter your password',
  'signIn': 'Sign in',
  'login.noAccount': "Don't have an account? Create one",
  'login.demo': 'Demo accounts',
  'demo.ahmad': 'Customer · Ahmad',
  'demo.sara': 'Customer · Sara',
  'demo.admin': 'Admin',
  'register.title': 'Create account',
  'register.name': 'Full name',
  'register.nameShort': 'At least 2 characters',
  'register.phone': 'Phone (optional)',
  'register.passwordHint': '8+ characters with upper, lower case and a digit',
  'register.weak': 'Password is too weak',
  'register.note': 'New accounts are always customers. Admin accounts cannot be created from the app.',

  // Navigation
  'nav.shop': 'Shop',
  'nav.cart': 'Cart',
  'nav.orders': 'Orders',
  'nav.alerts': 'Alerts',
  'nav.profile': 'Profile',
  'nav.dashboard': 'Dashboard',
  'nav.inventory': 'Inventory',

  // Products
  'shop.title': 'Shop',
  'sort.newest': 'Newest',
  'sort.priceAsc': 'Price: low to high',
  'sort.priceDesc': 'Price: high to low',
  'sort.name': 'Name',
  'shop.search': 'Search products',
  'all': 'All',
  'shop.empty': 'No products found',
  'cart.added': 'Added {name} to cart',
  'cart.addedQty': 'Added {qty} × {name} to cart',
  'product.noDescription': 'No description.',
  'stock.out': 'Out of stock',
  'stock.few': 'Only {n} left',
  'stock.in': 'In stock ({n})',
  'cart.allIn': 'All in cart',
  'cart.add': 'Add to cart',

  // Cart
  'cart.title': 'Cart',
  'clear': 'Clear',
  'cart.empty': 'Your cart is empty',
  'cart.each': '{price} each',
  'cart.address': 'Shipping address',
  'cart.note': 'Note (optional)',
  'cart.items': '{n} item(s)',
  'cart.placeOrder': 'Place order',
  'cart.placed': 'Order {id} placed!',
  'cart.addressShort': 'Enter a shipping address (at least 5 characters)',

  // Orders
  'orders.all': 'All orders',
  'orders.mine': 'My orders',
  'orders.empty': 'No orders yet',
  'orders.summary': '{n} item(s) · {total}',
  'order.title': 'Order',
  'order.cancelQ': 'Cancel order?',
  'order.cancelBody': 'The items go back to stock.',
  'keep': 'Keep',
  'order.cancel': 'Cancel order',
  'order.cancelled': 'Order cancelled',
  'order.status': 'Status',
  'order.note': 'Note: {note}',
  'order.placed': 'Placed {date}',
  'order.total': 'Total',
  'order.tracking': 'Tracking',
  'order.markAs': 'Mark as {status}',
  'order.moved': 'Order → {status} (customer notified)',

  // Notifications
  'notifications.title': 'Notifications',
  'notifications.markAll': 'Mark all read',
  'notifications.empty': 'No notifications',
  'notifications.allAdmins': 'all admins',
  'n.welcome.title': 'Welcome!',
  'n.welcome.body': 'Your account is ready.',
  'n.received.title': 'Order received',
  'n.received.body': 'Your order {id} was placed.',
  'n.newOrder.title': 'New order',
  'n.newOrder.body': 'Order {id} was placed.',
  'n.update.title': 'Order update',
  'n.update.body': 'Your order {id} is now {status}.',
  'n.lowStock.title': 'Low stock',
  'n.outOfStock.title': 'Out of stock',

  // Profile
  'profile.title': 'Profile',
  'profile.edit': 'Edit profile',
  'name': 'Name',
  'phone': 'Phone',
  'cancel': 'Cancel',
  'save': 'Save',
  'profile.updated': 'Profile updated',
  'notSet': 'Not set',
  'security.entry': 'Security test',
  'security.entrySub': 'Try actions outside your permissions and see the server reject them',
  'server': 'Server',
  'signOut': 'Sign out',

  // Admin
  'admin.revenue': 'Revenue',
  'admin.orders': 'Orders',
  'admin.pending': 'Pending',
  'admin.byStatus': 'Orders by status',
  'admin.lowStock': 'Low stock (≤ 5)',
  'admin.wellStocked': 'All products are well stocked',
  'admin.left': '{n} left',
  'inventory.hidden': 'hidden',
  'inventory.hide': 'Hide from store',
  'inventory.restore': 'Restore',
  'inventory.hiddenDone': '{name} hidden from the store',
  'inventory.restored': '{name} restored',

  // Common
  'retry': 'Retry',
  'error': 'Error',
  'status.PENDING': 'PENDING',
  'status.CONFIRMED': 'CONFIRMED',
  'status.SHIPPED': 'SHIPPED',
  'status.DELIVERED': 'DELIVERED',
  'status.CANCELLED': 'CANCELLED',
  'role.CUSTOMER': 'CUSTOMER',
  'role.ADMIN': 'ADMIN',

  // Security test
  'sec.title': 'Security test',
  'sec.you': 'You are {email}',
  'sec.role': 'Role {role}. Requests are sent with your own token.',
  'sec.victim': 'Victim: {email}, order {id}',
  'sec.victimUnknown': 'The victim is another demo customer.',
  'sec.result': '{passed} / {total} behaved as expected',
  'sec.skipped': 'Skipped for admins (would change real data)',
  'sec.expect': '{method} · expect {expected}',
  'sec.got': 'got {status} ({ms} ms)',
  'sec.runAll': 'Run all',
  'sec.running': 'Running…',
  'sec.noVictim': 'Could not sign in the demo victim ({email}): {status}. Run "npm run seed" in backend/.',
  'sec.noData': 'The victim has no orders yet. Run "npm run seed" in backend/.',
  'code.200': 'allowed',
  'code.400': 'invalid request',
  'code.401': 'not authenticated',
  'code.403': 'forbidden',
  'code.404': 'not found',
  'code.423': 'locked',
  'code.429': 'too many requests',

  'sec.noToken': 'Read orders without a token',
  'sec.noToken.why': 'Every route needs a JWT.',
  'sec.forged': 'Use a forged ADMIN token',
  'sec.forged.why': 'Signature checked with the server secret.',
  'sec.registerAdmin': 'Register yourself as ADMIN',
  'sec.registerAdmin.why': 'Unknown field "role" is rejected.',
  'sec.createProduct': 'Create a product',
  'sec.createProduct.why': 'Admin-only route.',
  'sec.deliver': "Mark the victim's order DELIVERED",
  'sec.deliver.why': 'Only admins change status.',
  'sec.listUsers': 'List all users',
  'sec.stats': 'Read sales statistics',
  'sec.system': 'Read system information',
  'sec.adminOnly': 'Admin-only route.',
  'sec.openOrder': "Open the victim's order",
  'sec.openOrder.why': 'Owner or admin only.',
  'sec.cancelOrder': "Cancel the victim's order",
  'sec.cancelOrder.why': 'Ownership checked first.',
  'sec.readNotification': "Mark the victim's notification read",
  'sec.readNotification.why': 'Personal notifications belong to their owner.',
  'sec.negative': 'Order a negative quantity',
  'sec.negative.why': 'Validation (customers) / only customers order (admins).',
  'sec.control': 'Control: the victim opens their own order',
  'sec.control.why': 'Allowed access still works.',
};

const _ar = <String, String>{
  'app.title': 'المتجر',
  'language': 'اللغة',
  'language.switch': 'English',

  // Auth
  'login.welcome': 'أهلاً فيك',
  'login.subtitle': 'سجّل دخولك لتكمّل تسوّق',
  'email': 'البريد الإلكتروني',
  'email.invalid': 'اكتب بريد إلكتروني صحيح',
  'password': 'كلمة السر',
  'password.required': 'اكتب كلمة السر',
  'signIn': 'تسجيل الدخول',
  'login.noAccount': 'ما عندك حساب؟ اعمل حساب جديد',
  'login.demo': 'حسابات تجريبية',
  'demo.ahmad': 'زبون · أحمد',
  'demo.sara': 'زبونة · سارة',
  'demo.admin': 'مدير',
  'register.title': 'حساب جديد',
  'register.name': 'الاسم الكامل',
  'register.nameShort': 'حرفين على الأقل',
  'register.phone': 'رقم الموبايل (اختياري)',
  'register.passwordHint': '8 أحرف أو أكتر، فيها حرف كبير وحرف صغير ورقم',
  'register.weak': 'كلمة السر ضعيفة',
  'register.note': 'الحسابات الجديدة دايماً زبائن. ما فيك تعمل حساب مدير من التطبيق.',

  // Navigation
  'nav.shop': 'المتجر',
  'nav.cart': 'السلة',
  'nav.orders': 'الطلبات',
  'nav.alerts': 'الإشعارات',
  'nav.profile': 'حسابي',
  'nav.dashboard': 'لوحة التحكم',
  'nav.inventory': 'المخزون',

  // Products
  'shop.title': 'المتجر',
  'sort.newest': 'الأحدث',
  'sort.priceAsc': 'السعر: من الأقل للأعلى',
  'sort.priceDesc': 'السعر: من الأعلى للأقل',
  'sort.name': 'الاسم',
  'shop.search': 'دوّر على منتج',
  'all': 'الكل',
  'shop.empty': 'ما في منتجات',
  'cart.added': 'انضاف {name} للسلة',
  'cart.addedQty': 'انضاف {qty} × {name} للسلة',
  'product.noDescription': 'ما في وصف.',
  'stock.out': 'نفد من المخزون',
  'stock.few': 'باقي {n} بس',
  'stock.in': 'متوفر ({n})',
  'cart.allIn': 'كلهم بالسلة',
  'cart.add': 'أضف للسلة',

  // Cart
  'cart.title': 'السلة',
  'clear': 'تفريغ',
  'cart.empty': 'السلة فاضية',
  'cart.each': '{price} للقطعة',
  'cart.address': 'عنوان التوصيل',
  'cart.note': 'ملاحظة (اختياري)',
  'cart.items': '{n} قطعة',
  'cart.placeOrder': 'اطلب الآن',
  'cart.placed': 'تم إرسال الطلب {id}!',
  'cart.addressShort': 'اكتب عنوان التوصيل (5 أحرف على الأقل)',

  // Orders
  'orders.all': 'كل الطلبات',
  'orders.mine': 'طلباتي',
  'orders.empty': 'ما في طلبات لسا',
  'orders.summary': '{n} قطعة · {total}',
  'order.title': 'الطلب',
  'order.cancelQ': 'إلغاء الطلب؟',
  'order.cancelBody': 'المنتجات بترجع للمخزون.',
  'keep': 'لا، خليه',
  'order.cancel': 'إلغاء الطلب',
  'order.cancelled': 'تم إلغاء الطلب',
  'order.status': 'الحالة',
  'order.note': 'ملاحظة: {note}',
  'order.placed': 'تاريخ الطلب {date}',
  'order.total': 'المجموع',
  'order.tracking': 'تتبع الطلب',
  'order.markAs': 'غيّر لـ {status}',
  'order.moved': 'الطلب صار {status} (وصل إشعار للزبون)',

  // Notifications
  'notifications.title': 'الإشعارات',
  'notifications.markAll': 'تعليم الكل كمقروء',
  'notifications.empty': 'ما في إشعارات',
  'notifications.allAdmins': 'لكل المدراء',
  'n.welcome.title': 'أهلاً وسهلاً!',
  'n.welcome.body': 'حسابك جاهز.',
  'n.received.title': 'وصلنا طلبك',
  'n.received.body': 'طلبك {id} انبعت بنجاح.',
  'n.newOrder.title': 'طلب جديد',
  'n.newOrder.body': 'في طلب جديد {id}.',
  'n.update.title': 'تحديث على طلبك',
  'n.update.body': 'طلبك {id} صار: {status}.',
  'n.lowStock.title': 'المخزون قرب يخلص',
  'n.outOfStock.title': 'نفد من المخزون',

  // Profile
  'profile.title': 'حسابي',
  'profile.edit': 'تعديل الحساب',
  'name': 'الاسم',
  'phone': 'الموبايل',
  'cancel': 'إلغاء',
  'save': 'حفظ',
  'profile.updated': 'تم حفظ التعديلات',
  'notSet': 'مو محدد',
  'security.entry': 'اختبار الأمان',
  'security.entrySub': 'جرّب عمليات أكبر من صلاحياتك، وشوف كيف السيرفر بيرفضها',
  'server': 'السيرفر',
  'signOut': 'تسجيل الخروج',

  // Admin
  'admin.revenue': 'الإيرادات',
  'admin.orders': 'الطلبات',
  'admin.pending': 'قيد الانتظار',
  'admin.byStatus': 'الطلبات حسب الحالة',
  'admin.lowStock': 'مخزون منخفض (5 أو أقل)',
  'admin.wellStocked': 'كل المنتجات متوفرة بكمية كافية',
  'admin.left': 'باقي {n}',
  'inventory.hidden': 'مخفي',
  'inventory.hide': 'إخفاء من المتجر',
  'inventory.restore': 'إرجاع للمتجر',
  'inventory.hiddenDone': 'انخفى {name} من المتجر',
  'inventory.restored': 'رجع {name} للمتجر',

  // Common
  'retry': 'حاول مرة تانية',
  'error': 'خطأ',
  'status.PENDING': 'قيد الانتظار',
  'status.CONFIRMED': 'مؤكد',
  'status.SHIPPED': 'تم الشحن',
  'status.DELIVERED': 'تم التوصيل',
  'status.CANCELLED': 'ملغي',
  'role.CUSTOMER': 'زبون',
  'role.ADMIN': 'مدير',

  // Security test
  'sec.title': 'اختبار الأمان',
  'sec.you': 'إنت داخل كـ {email}',
  'sec.role': 'الدور: {role}. كل الطلبات بتنبعت بالتوكن تبعك.',
  'sec.victim': 'الضحية: {email}، الطلب {id}',
  'sec.victimUnknown': 'الضحية زبون تجريبي تاني.',
  'sec.result': '{passed} من {total} تصرّفوا متل المتوقع',
  'sec.skipped': 'ما بينجرّب للمدير (رح يغيّر بيانات حقيقية)',
  'sec.expect': '{method} · المتوقع {expected}',
  'sec.got': 'النتيجة {status} ({ms} ms)',
  'sec.runAll': 'شغّل الكل',
  'sec.running': 'عم يشتغل…',
  'sec.noVictim': 'ما قدرنا ندخل بحساب الضحية التجريبي ({email}): {status}. شغّل "npm run seed" بمجلد backend.',
  'sec.noData': 'الضحية ما عنده طلبات. شغّل "npm run seed" بمجلد backend.',
  'code.200': 'مسموح',
  'code.400': 'طلب غير صالح',
  'code.401': 'غير مسجّل دخول',
  'code.403': 'ممنوع، ما عندك صلاحية',
  'code.404': 'مو موجود',
  'code.423': 'الحساب مقفول',
  'code.429': 'طلبات كتير',

  'sec.noToken': 'تشوف الطلبات بدون توكن',
  'sec.noToken.why': 'كل الطلبات لازم يكون معها JWT.',
  'sec.forged': 'تستعمل توكن مزوّر مكتوب فيه ADMIN',
  'sec.forged.why': 'السيرفر بيتحقق من التوقيع بالمفتاح السري تبعه.',
  'sec.registerAdmin': 'تسجّل حساب جديد كمدير',
  'sec.registerAdmin.why': 'الحقل "role" مرفوض بالتسجيل.',
  'sec.createProduct': 'تضيف منتج',
  'sec.createProduct.why': 'للمدير بس.',
  'sec.deliver': 'تغيّر طلب الضحية لـ "تم التوصيل"',
  'sec.deliver.why': 'المدير بس بيغيّر حالة الطلب.',
  'sec.listUsers': 'تشوف قائمة كل المستخدمين',
  'sec.stats': 'تشوف إحصائيات المبيعات',
  'sec.system': 'تشوف معلومات النظام',
  'sec.adminOnly': 'للمدير بس.',
  'sec.openOrder': 'تفتح طلب الضحية',
  'sec.openOrder.why': 'لصاحب الطلب أو المدير بس.',
  'sec.cancelOrder': 'تلغي طلب الضحية',
  'sec.cancelOrder.why': 'السيرفر بيتحقق من صاحب الطلب أول شي.',
  'sec.readNotification': 'تعلّم إشعار الضحية كمقروء',
  'sec.readNotification.why': 'الإشعار الشخصي لصاحبه بس.',
  'sec.negative': 'تطلب كمية بالسالب',
  'sec.negative.why': 'التحقق من المدخلات (للزبون) / الطلب للزبائن بس (للمدير).',
  'sec.control': 'للمقارنة: الضحية بتفتح طلبها هي',
  'sec.control.why': 'الوصول المسموح لازم يضل شغّال.',
};
