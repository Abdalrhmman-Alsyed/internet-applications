# Mobile (Flutter)

تطبيق واحد بيتغير حسب الدور: **الزبون** (متجر، سلة، طلبات، إشعارات) و**الأدمن** (وضع إدارة خفيف: الطلبات الواردة، تغيير الحالة، المخزون).

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
├── core/
│   ├── config/env.dart                  روابط الباك إند
│   ├── network/api_client.dart          Dio + التوكن + refresh تلقائي عند 401 + ApiException
│   ├── storage/token_storage.dart       التوكنات بـ Keystore/Keychain
│   └── realtime/notifications_socket.dart  الإشعارات اللحظية
└── features/
    ├── auth/           (فلاتر 1)
    ├── products/       (فلاتر 1)
    ├── cart/           (فلاتر 1)
    ├── orders/         (فلاتر 2)
    ├── notifications/  (فلاتر 2)
    └── admin/          (فلاتر 2)
```

كل feature فيها: `data/` (الـ repository اللي بيستعمل `ApiClient`)، `models/`، `screens/`، `widgets/`.

أي خطأ من الـ API بيوصلكم `ApiException(statusCode, message)`، فما بتحتاجوا تقرأوا الـ JSON يدوياً.
