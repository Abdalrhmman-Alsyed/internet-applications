# Mobile (Flutter)

تطبيق واحد بيتغير حسب الدور. السيرفر نفسه بيفرض نفس التقسيم.

| الدور | التبويبات |
|---|---|
| **زبون** | Shop (بحث، تصنيفات، ترتيب) ← تفاصيل المنتج ← Cart ← Place order · Orders (تتبع الحالة، إلغاء) · Alerts (لحظية) · Profile |
| **أدمن** | Dashboard (إحصائيات، مخزون منخفض) · Orders (تغيير الحالة) · Inventory (مخزون، إخفاء) · Alerts · Profile |

**Profile ← Security test:** بيبعت طلبات بتتجاوز الصلاحيات **بتوكن المستخدم نفسه**، وبيعرض رد السيرفر (401 / 403 / 400). مخصص للعرض قدام المعيد.

الحسابات التجريبية (بعد `npm run seed` بالباك إند) موجودة كأزرار بشاشة الدخول.

## ⚠️ مسار المشروع

خلّوا المشروع بمسار **كل أحرفه إنكليزية** (مثلاً `C:\Projects\ecommerce`). Gradle/Java على Windows ما بيقدر يبني من مسار فيه أحرف عربية، وبيطلع خطأ `Could not find or load main class org.gradle.wrapper.GradleWrapperMain`.

**إصدارات Android:** رفعنا AGP لـ 8.7.3 وGradle لـ 8.10.2 وKotlin لـ 2.1.0، لأن الإصدارات الافتراضية لـ Flutter 3.27 ما بتشتغل مع JDK 21 تبع Android Studio. ولا تحدّثوا `flutter_secure_storage` لـ v10 قبل ما تحدّثوا Flutter.

## التشغيل

الباك إند لازم يكون شغّال (`docker compose up -d` من جذر المشروع).

```bash
flutter pub get
flutter run
```

- **Android Emulator:** بيوصل للجهاز على `10.0.2.2`، وهاد الافتراضي، ما بتحتاج شي.
- **موبايل حقيقي على نفس الشبكة:**

```bash
flutter run --dart-define=API_URL=http://192.168.1.10:3000 --dart-define=WS_URL=http://192.168.1.10:3004
```

## البنية

```
lib/
├── main.dart                    Providers + اختيار الشاشة حسب حالة الدخول والدور
├── core/
│   ├── config/env.dart          روابط الباك إند (+ تصحيح روابط الصور للـ emulator)
│   ├── network/api_client.dart  Dio + التوكن + refresh تلقائي عند 401 + ApiException + raw()
│   ├── storage/token_storage.dart  التوكنات بـ Keystore/Keychain
│   ├── realtime/notifications_socket.dart  Socket.io
│   ├── models.dart              User, Product, Order, AppNotification…
│   └── widgets.dart             StatusChip, ErrorView, ProductImage, snackbars
└── features/
    ├── shell.dart               التبويبات حسب الدور
    ├── auth/                    login, register, AuthController
    ├── products/                القائمة والتفاصيل
    ├── cart/                    CartController + شاشة السلة والطلب
    ├── orders/                  القائمة والتفاصيل (تتبع + إجراءات حسب الدور)
    ├── notifications/           NotificationsController (لحظي) + الشاشة
    ├── profile/                 الملف الشخصي
    ├── admin/                   Dashboard + Inventory
    └── security/                Security test
```

الحالة بـ `provider` (ChangeNotifier). أي خطأ من الـ API بيوصل كـ `ApiException(statusCode, message)`.
