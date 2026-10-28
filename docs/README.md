# شرح المشروع للفريق

هاد الملف بيشرح شو انعمل بالمشروع وكيف بيشتغل من جوا، لحتى كل واحد بالفريق يفهم الأجزاء اللي مش إلو. للتشغيل شوف [README الرئيسي](../README.md)، وللتفاصيل والقرارات شوف [ARCHITECTURE.md](ARCHITECTURE.md).

---

## الفكرة بسطرين

منصة تجارة إلكترونية مبنية **Microservices** بـ NestJS: **API Gateway** واحد هو باب الدخول، ووراه أربع خدمات (المستخدمين، المنتجات، الطلبات، الإشعارات)، كل خدمة إلها قاعدة بيانات لحالها. في واجهتين: **لوحة تحكم للأدمن بـ Next.js**، و**تطبيق Flutter** للزبون والأدمن. وكل شي بيشتغل بـ `docker compose up`.

```
Next.js / Flutter ──HTTP+JWT──► API Gateway :3000 ──TCP──► users · products · orders · notifications
                                                               │          │         │
                                                               └── events ─┴─────────┴──► RabbitMQ ──► notifications ──Socket.io──► العملاء
PostgreSQL: users_db · products_db · orders_db · notifications_db       MinIO: صور المنتجات
```

---

## الحاويات التسعة (ليش هالقد)

كل خدمة برنامج مستقل، فبتاخد container لحالها: **3 بنية تحتية + 5 باك + 1 ويب = 9**. تطبيق Flutter مش container لأنو بيشتغل على الموبايل.

| الحاوية | البورت على جهازك | شغلتها |
|---|---|---|
| `postgres` | `5433` | 4 قواعد منفصلة بنفس الـ container (لتوفير الرام). 5433 لحتى ما يتعارض مع Postgres منزّل عندكم |
| `rabbitmq` | `5672`، واجهة `15672` | طابور الأحداث |
| `minio` | `9000`، واجهة `9001` | تخزين الصور (متوافق مع S3) |
| `api-gateway` | `3000` | الوحيد من الباك المفتوح للعالم، ومعه Swagger على `/docs` |
| `users-service` | مخفي | التسجيل، الدخول، التوكنات، قفل الحساب |
| `products-service` | مخفي | المنتجات، التصنيفات، الصور، المخزون |
| `orders-service` | مخفي | الطلبات، الحالات، الملكية، الإحصائيات |
| `notifications-service` | `3004` | الإشعارات. البورت مفتوح لأنو الـ WebSocket لازم العميل يوصله مباشرة |
| `web` | `3001` | لوحة التحكم |

أشياء بالـ compose لازم تعرفوها:

- **Dockerfile واحد لكل الباك** (`backend/Dockerfile`)، والفرق بـ `--build-arg APP=<الخدمة>`.
- الخدمات ما بتقلع إلا لما Postgres و RabbitMQ يصيروا **healthy**.
- كل خدمة بتشغّل الـ **migrations** لحالها قبل ما تقلع (`backend/docker-entrypoint.sh`).
- القواعد الأربعة بتنعمل من `docker/postgres/init.sql` **بس أول مرة** (لما الـ volume فاضي).
- جوا شبكة Docker الحاويات بتنادي بعضها بالاسم: `postgres:5432`، `users-service:3001`.

---

## مسار طلب شراء (أهم شي بالمشروع)

1. الزبون بيبعت `POST /api/v1/orders` مع التوكن.
2. الـ Gateway بيمرّره على: **rate limit**، بعدين **JWT**، بعدين **الدور لازم CUSTOMER**، بعدين **التحقق من الـ body** (DTO).
3. orders-service بيطلب من products-service بـ TCP **يحجز المخزون**: `UPDATE … WHERE stock >= qty` جوا transaction، فما في بيع لآخر قطعة مرتين.
4. products-service بيرجّع **السعر والاسم من الـ DB**. السعر ما بيجي من العميل أبداً.
5. orders-service بيحفظ الطلب. إذا فشل الحفظ بيرجّع المخزون (compensation).
6. بينشر حدث `order.created` على RabbitMQ **وبيرد على الزبون فوراً**.
7. notifications-service بيستقبل الحدث، بيحفظ إشعار للزبون وللأدمن، وبيبعتهم لحظياً بـ Socket.io.

**القاعدة:** إذا بدك جواب (حجز مخزون) فاستعمل **TCP**. وإذا بس عم تخبّر (انعمل طلب) فاستعمل **حدث على RabbitMQ**.

---

## الباك إند (`backend/`)

```
apps/api-gateway/src/common/   guards.ts · decorators.ts · http-exception.filter.ts
apps/api-gateway/src/<feature>/ controllers + DTOs (auth, users, products, orders, notifications, health)
apps/<service>/prisma/          schema.prisma + migrations لكل خدمة
apps/<service>/src/             منطق الخدمة
libs/common/src/                PATTERNS و EVENTS (أسماء الرسائل)، rpc.ts، clients.ts، types.ts
test/api.e2e-spec.ts            34 اختبار على النظام الحقيقي
```

- **الحماية global على كل الـ routes** بالترتيب: `ThrottlerGuard` ← `JwtAuthGuard` ← `RolesGuard`. أي route جديد محمي تلقائياً، ولتفتحه لازم تكتب `@Public()` صراحة.
- **الصلاحيات بطبقتين:** `@Roles(ADMIN)` بالـ Gateway، **و** فحص الملكية والدور جوا الخدمة (`getAuthorized` بـ `orders.service.ts`). زبون بيفتح طلب غيره فبياخد **403**.
- **التحقق:** `ValidationPipe` مع `whitelist` و `forbidNonWhitelisted`، يعني أي حقل زيادة (متل `"role": "ADMIN"` بالتسجيل) بيرجع **400**.
- **صيغة خطأ وحدة** لكل الـ API: `{ success, statusCode, error, message, path, method, timestamp }`. الخدمة بترمي `HttpException` عادية، و `AllRpcExceptionsFilter` بينقلها بـ TCP، و `sendRpc` بيرجّعها بنفس الكود. خدمة طافية بترجع **503**.
- **المصادقة:** bcrypt (12 round)، و access token عمره 15 دقيقة، و refresh عمره 7 أيام **بينستعمل مرة وحدة** (rotation)، وإعادة استعماله بتلغي الجلسة. 5 محاولات دخول غلط بتقفل الحساب 15 دقيقة (**423**). و 20 طلب دخول بالدقيقة لكل IP (**429**).
- **حالات الطلب:** `PENDING → CONFIRMED → SHIPPED → DELIVERED`، والإلغاء من `PENDING` أو `CONFIRMED`، والمخزون بيرجع. الزبون بيلغي طلبه بس إذا `PENDING`. كل تغيير بينحفظ بـ `OrderStatusHistory`.
- **المنتجات:** حذف ناعم (`isActive = false`)، والسعر `Decimal` مش float. الصور بـ MinIO، ونوعها بينفحص من أول البايتات (magic bytes)، والحد 5MB و 8 صور. المخزون ≤ 5 بيبعت إشعار للأدمن.
- **RabbitMQ:** طابور `durable`، ورسائل `persistent`، و **manual ack**. إذا خدمة الإشعارات طافية، الرسائل بتستنى وبتنعالج لما ترجع.

### إضافة endpoint جديد

1. اسم الرسالة بـ `libs/common/src/constants.ts` (`PATTERNS`).
2. الدالة بالـ service، والـ `@MessagePattern` بالـ controller تبع الخدمة.
3. الـ route والـ DTO بالـ Gateway. الـ Swagger بيطلع لحاله من الـ DTO والتعليقات (`/** @example … */`).
4. إذا في route ثابت متل `stats`، حطه **قبل** `':id'` بالـ controller.

---

## الويب (`web/`)

Next.js 15 (App Router) مع React 19 و Tailwind 4. لوحة تحكم **للأدمن بس** على http://localhost:3001.

- `src/lib/api.ts`: المكان الوحيد اللي بيحكي مع السيرفر. بيحط التوكن، وعند **401** بيعمل refresh مرة وحدة وبيعيد الطلب (والطلبات المتزامنة بتستنى نفس الـ refresh). و `raw()` ما بترمي خطأ، الـ Security lab بيستعملها.
- `src/lib/auth.tsx`: المستخدم الحالي. و `src/lib/realtime.tsx`: Socket.io، كل إشعار بيطلع toast وبيحدّث الصفحات.
- `src/app/(dash)/layout.tsx`: الحماية. مش مسجّل فبيروح على `/login`. زبون بيشوف **Access denied** مع رد السيرفر **403** الحقيقي.
- الصفحات: Overview، Orders، Products، Categories، Users، Notifications، **System** (حالة الخدمات، وطابور RabbitMQ، وإعدادات الأمان، وكل الـ endpoints)، و**Security lab** (18 محاولة اختراق حقيقية مع رد السيرفر).
- `NEXT_PUBLIC_API_URL` بينكتب جوا الكود **وقت البناء**، ولهيك هو build arg بالـ compose، وقيمته `localhost:3000` لأنو الكود بيشتغل بمتصفح المستخدم.

---

## الموبايل (`mobile/`)

Flutter، تطبيق واحد **بيتغيّر حسب الدور**، وفيه عربي وإنكليزي.

| الزبون | الأدمن |
|---|---|
| Shop ← Cart ← Orders ← Alerts ← Profile | Dashboard ← Orders ← Inventory ← Alerts ← Profile |

- **المكتبات:** `dio` للطلبات، و `provider` للحالة، و `flutter_secure_storage` للتوكنات (Keystore / Keychain)، و `socket_io_client`، و `shared_preferences` للغة بس.
- `lib/core/network/api_client.dart`: interceptor بيحط التوكن، وعند 401 بيعمل refresh وبيعيد الطلب، وإذا فشل بيرجّع المستخدم لشاشة الدخول. والأخطاء بتوصل كـ `ApiException(statusCode, message)`.
- `lib/main.dart` ← `_AuthGate`: دخول، أو `AppShell(admin: …)`.
- **السلة محلية**، وبالـ checkout منبعت بس `productId` و `quantity`، والسيرفر بيحسب السعر.
- **Security test** (Profile): نفس فكرة Security lab، بتوكن المستخدم المسجّل.

### ملاحظات للتشغيل على Android Studio

- المحاكي بيوصل لجهازك على `10.0.2.2` (مش `localhost`)، وهاد الافتراضي بـ `lib/core/config/env.dart`. لموبايل حقيقي: `--dart-define=API_URL=http://<IP جهازك>:3000`.
- `android/app/build.gradle` فيه `ndkVersion = "27.0.12077973"` لأنو `flutter_secure_storage` و `path_provider_android` بيطلبوها. Gradle بينزّلها لحاله أول ما يحتاجها.
- **خلّوا محاكي واحد بس شغّال**، وتأكدوا إنو هو المختار بالقائمة قبل Run ▶. صار معنا إنو التطبيق انفتح على محاكي مصغّر وما كنا شايفينه.
- إذا نافذة المحاكي ما بيّنت وإيقونتها بشريط المهام (`qemu-system-x86_64`)، غالباً هي برا الشاشة. فعّلوا من Android Studio: **Settings ← Tools ← Emulator ← Launch in the Running Devices tool window**، فبيفتح المحاكي جوا Android Studio.
- المشروع لازم يكون بمسار كل أحرفه إنكليزية، وإلا Gradle بيفشل.

---

## الأمان: وين منثبته

| الطريقة | وين |
|---|---|
| الموبايل | Profile ← Security test ← Run all |
| لوحة التحكم | Security lab ← Run all attacks (18 / 18)، و brute-force، و rate limit |
| زبون على اللوحة | Access denied مع 403 من السيرفر |
| اختبارات آلية | `cd backend && npm run test:e2e` (34 اختبار) |
| Postman | `docs/postman/` ← مجلد **5. Security proofs** |

⚠️ تجربة الـ rate limit بتقفل الدخول من الجهاز (وحتى من المحاكي) دقيقة، فخلّوها آخر شي. وما تجرّبوا قفل الحساب على `ahmad@shop.local` قبل العرض، لأنو بيضل مقفول ربع ساعة.

---

## Swagger بسرعة

http://localhost:3000/docs

1. `GET /products` بدون توكن بيرجع **200** (عام)، و `GET /orders` بدون توكن بيرجع **401**.
2. `POST /auth/login` كـ `ahmad@shop.local` / `Customer@123`، بعدين **Authorize** والصق الـ `accessToken`.
3. `POST /orders` بـ `{"items":[{"productId":"<uuid>","quantity":1}],"shippingAddress":"Damascus, Mazzeh"}` بيرجع **201**.
4. `PATCH /orders/{id}/status` بتوكن الزبون بيرجع **403**.
5. سجّل كأدمن (`admin@shop.local` / `Admin@12345`)، ونفس الـ PATCH بـ `CONFIRMED` بيرجع **200**، والزبون بيوصله إشعار لحظي.

---

## نقاط معروفة للتحسين

إذا سألونا "شو بتحسّنوا؟":

- **Transactional Outbox:** حالياً إذا RabbitMQ طافي وقت الطلب، الحدث ممكن يضيع (الطلب بينحفظ عادي).
- **Dead Letter Queue** للرسائل اللي بتفشل (حالياً بتنحذف).
- **Redis** للـ rate limit والـ Socket.io adapter إذا شغّلنا أكتر من نسخة، وللكاش على المنتجات.
- **RS256** بدل HS256، لحتى بس خدمة المستخدمين توقّع التوكنات.
- **httpOnly cookie** للـ refresh token بالويب بدل `localStorage`.
- الأسرار بالـ compose قيم افتراضية (`change-me-…`)، وبالإنتاج لازم تكون بـ `.env`.
