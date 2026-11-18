# المتطلبات ← التنفيذ ← الإثبات

جدول للمقابلة: كل بند بالمتطلب، وين تنفّذ، وكيف منثبته قدام الدكتور.

## المتطلبات الوظيفية

| المتطلب | التنفيذ | الإثبات |
|---|---|---|
| تسجيل المستخدمين | `POST /auth/register`، `users-service/src/auth.service.ts` | Swagger / اختبار `registers customers` |
| إضافة المنتجات مع صورها وعرضها | `products-service` + MinIO، `POST /products/:id/images` | اختبار `admin uploads an image, which is publicly served` |
| إدارة المخزون | `PATCH /products/:id/stock` + حجز ذري عند الطلب + إرجاع عند الإلغاء + إشعار مخزون منخفض | اختبارات `cannot oversell` و `admin cancellation returns the stock` و `under concurrent load` |
| إنشاء الطلبات | `POST /orders`، `orders-service/src/orders.service.ts` | اختبار `customer places an order` |
| متابعة حالة الطلب | `GET /orders/:id` (فيه `history`) + إشعار لحظي عند كل تغيير | اختبار `admin changes status and the customer is notified in real time` |

## المتطلب الأول: API Design & Security

| البند | التنفيذ | الإثبات |
|---|---|---|
| اللغة والإطار | NestJS 11 + TypeScript | — |
| تقسيم الكود لأربع وحدات منفصلة | 4 خدمات مستقلة: `users`، `products`، `orders`، `notifications`، كل وحدة بقاعدة بياناتها | `docker compose ps` / `GET /health` |
| يعمل كاملاً بـ Docker | `docker compose up -d --build` يشغّل 14 حاوية (منها inventory-service بـ Go، و Redis، ونسخة قراءة لـ Postgres، و email-worker و Mailpit) | تشغيل حي |
| REST للمنتجات (إضافة مع صورة، عرض، تصفية حسب التصنيف، تقسيم صفحات) | `GET /products?categoryId=&minPrice=&maxPrice=&search=&inStock=&sort=&page=&limit=` | اختبار `anyone can browse with filters and pagination` |
| REST للطلبات (إنشاء، عرض، تغيير حالة) | `POST /orders`، `GET /orders(/:id)`، `PATCH /orders/:id/status` | Postman مجلد 3 |
| إصدار في المسار | `/api/v1/...` | — |
| رموز حالة صحيحة | 200/201/400/401/403/404/409/413/423/429/503 | الاختبارات |
| صيغة موحّدة للأخطاء | `api-gateway/src/common/http-exception.filter.ts` | `expectErrorShape` بكل اختبار + Postman `Error format is uniform` |
| توثيق (OpenAPI/Swagger + Postman) | http://localhost:3000/docs + `docs/postman/` | فتح الرابط |
| مصادقة JWT | access + refresh مع rotation | اختبار `rotates refresh tokens and rejects a reused one` |
| دوران: الزبون يرى طلباته فقط | `getAuthorized()` و `findAll()` بـ `orders.service.ts` | اختبارات `CANNOT read another customer's order` و `listing only returns the caller's own orders` |
| المسؤول وحده يغيّر حالة الطلب | `@Roles(ADMIN)` بالـ Gateway **و** فحص الدور بالخدمة | اختبار `customer CANNOT change order status` |
| تحديد عدد محاولات تسجيل الدخول | قفل الحساب بعد 5 محاولات (423) + rate limit لكل IP (429) | اختبارات `Brute-force protection` |
| ترويسات الأمان | Helmet | `curl -I http://localhost:3000/api/v1/health` |

## يُطلب إثبات: رفض الوصول لطلب غيره أو عملية خارج الصلاحية

أربع طرق، والتفاصيل بـ [DEMO.md](DEMO.md):

1. **الموبايل ← Profile ← Security test ← Run all**، بتوكن المستخدم الحقيقي.
2. **لوحة التحكم ← Security lab ← Run all attacks**: 18 فحص + brute-force + rate limit.
3. **زبون بيسجّل دخول على لوحة التحكم:** شاشة Access denied، وتحتها رد السيرفر 403.
4. **اختبارات آلية:** `cd backend && npm run test:e2e` (34 اختبار).

| المحاولة | النتيجة |
|---|---|
| زبون B يقرأ طلب زبون A | 403 |
| زبون B يلغي طلب زبون A | 403 |
| زبون B يعلّم إشعار A كمقروء | 403 |
| زبون يغيّر حالة طلب | 403 |
| زبون يضيف منتج / يرفع صورة | 403 |
| زبون يعرض قائمة المستخدمين | 403 |
| زبون يعرض إحصائيات المبيعات / معلومات النظام | 403 |
| طلب بدون توكن / بتوكن مزوّر | 401 |
| تسجيل حساب مع `"role": "ADMIN"` | 400 |
| WebSocket بتوكن غلط | قطع الاتصال |
| ملف تنفيذي باسم `.png` | 400 |

## المتطلب الرابع: Async Queues & Real-Time

التفاصيل: [REQUIREMENT-4-ASYNC-REALTIME.md](REQUIREMENT-4-ASYNC-REALTIME.md). الإثبات كامل: `demo-4.cmd`.

| البند | التنفيذ | الإثبات |
|---|---|---|
| نشر حدث عند إنشاء الطلب والرد بدون انتظار | `orders.service.ts` ← exchange `events`، routing key `order.created` | demo-4 خطوة 2: 201 خلال ~100 ms، الإيميل بعدها |
| عامل منفصل يبعت إيميل حقيقي | حاوية `email-worker` (nodemailer)، الإعدادات من `.env` | Mailpit http://localhost:8025 + اختبار `the email worker sends the confirmation email` |
| ack بعد الإرسال | `channel.ack(msg)` بعد `sendMail` | demo-4 خطوة 3: وقّفنا العامل، 3 رسائل استنوا، رجع وبعتهم |
| إعادة محاولة | `email.retry` مع TTL لكل رسالة (5 ث / 30 ث / 2 د) | demo-4 خطوة 4: وقّفنا سيرفر البريد، المحاولة 2 نجحت |
| DLQ | `x-dead-letter-exchange: email.dlx` ← `email.dead` | demo-4 خطوة 5: `email.dead` 0 ← 1 |
| تتبّع الطلب لحظياً، وبس لصاحبه | صفحة `/track` + قناة `order:<id>` بفحص ملكية | اختبار `only the owner can follow an order channel` و `a status change reaches the owner live, and nobody else` |
| لوحة أدمن لحظية، وبس للأدمن | قناة `admin.orders` | اختبار `only admins can subscribe to the admin channel` و `a new order reaches the admin channel instantly` |
| تحقق قبل الاشتراك | `notifications.gateway.ts` ← `subscribe()` | demo-4 خطوة 6 (401 / 403 / 403) |
| مكتبة جاهزة للـ WebSocket | Socket.io | — |

