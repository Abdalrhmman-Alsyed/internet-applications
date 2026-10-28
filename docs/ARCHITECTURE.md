# المعمارية

## الصورة العامة

```
              ┌──────────────┐     ┌──────────────┐
              │  Next.js web │     │ Flutter app  │
              └──────┬───────┘     └──────┬───────┘
                     │  HTTPS/JSON (JWT)  │            Socket.io (JWT)
                     ▼                    ▼                  │
              ┌────────────────────────────────┐             │
              │          API Gateway :3000      │             │
              │ JWT · Roles · Rate limit ·      │             │
              │ Validation · Swagger · Errors   │             │
              └──┬──────────┬──────────┬───────┬┘             │
            TCP  │     TCP  │     TCP  │   TCP │              │
                 ▼          ▼          ▼       ▼              ▼
          ┌──────────┐ ┌──────────┐ ┌────────┐ ┌──────────────────────┐
          │  users   │ │ products │◄┤ orders │ │    notifications     │
          │  :3001   │ │  :3002   │ │ :3003  │ │ TCP :3005 · WS :3004 │
          └────┬─────┘ └──┬────┬──┘ └───┬────┘ └──────────▲───────────┘
               │          │    │        │                 │
               │   events │    └─MinIO  │ events          │ consume
               └──────────┴─────────────┴──► RabbitMQ ────┘
                                         (notifications_queue)

         PostgreSQL: users_db · products_db · orders_db · notifications_db
```

## مسار طلب شراء

1. الزبون: `POST /api/v1/orders` مع التوكن.
2. الـ Gateway: يتحقق من الـ JWT ← يتحقق إنه `CUSTOMER` ← يتحقق من الـ body (DTO) ← يبعت لـ orders-service.
3. orders-service يطلب من products-service (TCP) **حجز المخزون**: transaction فيها `UPDATE ... WHERE stock >= qty`، فلو طلبين وصلوا بنفس اللحظة على آخر قطعة، واحد بس بينجح.
4. products-service يرجّع **السعر والاسم من قاعدة البيانات** (السعر ما بيجي من العميل أبداً).
5. orders-service يحفظ الطلب. إذا فشل الحفظ، بيرجّع المخزون (compensation).
6. orders-service ينشر حدث `order.created` على RabbitMQ ويرد فوراً للزبون.
7. notifications-service يستقبل الحدث (بشكل غير متزامن)، يحفظ إشعار للزبون وإشعار للأدمن، ويبعتهم لحظياً عبر Socket.io.

## القرارات وأسبابها

| القرار | بدل | ليش |
|---|---|---|
| **Microservices** (NestJS monorepo) | Modular monolith | المشروع بيطلب خدمات تعمل معاً وتواصل بينها ومعالجة غير متزامنة. كل باك بيملك خدماته بدون تعارض. الـ monorepo بيخلي الكود المشترك بمكتبة وحدة (`libs/common`). |
| **API Gateway** | كشف كل خدمة | نقطة دخول وحدة للعملاء. المصادقة والـ rate limit والتحقق والـ Swagger بمكان واحد بدل ما تتكرر وتنسى بخدمة. |
| **TCP** بين الـ Gateway والخدمات | HTTP داخلي | مدعوم مباشرة بـ NestJS، أسرع، وما في routes مكررة. |
| **RabbitMQ** للأحداث | Kafka / Redis Pub/Sub | Kafka تقيلة على أجهزتنا وأكبر من حاجتنا. Redis Pub/Sub بيضيّع الرسالة إذا المستهلك طافي. RabbitMQ بيحفظها (durable queue + manual ack) لحد ما تنعالج. |
| **PostgreSQL** | MongoDB | بيانات علائقية (طلب ← عناصر ← منتجات) ومحتاجين transactions لحجز المخزون. |
| **Database لكل خدمة** | قاعدة مشتركة | ما في خدمة بتلمس جداول غيرها؛ التواصل عبر الرسائل بس. على container واحد لتوفير الرام. |
| **Prisma** | TypeORM | type-safety كاملة، migrations واضحة، schema مقروء. |
| **JWT** access (15 دقيقة) + refresh (7 أيام) مع rotation | Sessions | ما بيحتاج مخزن جلسات مشترك بين الخدمات، مناسب للموبايل. الـ refresh بينستعمل مرة وحدة؛ إعادة استعمال توكن قديم بتلغي الجلسة. |
| **MinIO** (S3) للصور | القرص / الـ DB | القرص بيخرب مع أكتر من نسخة من الخدمة؛ الـ DB بتتبطأ. نفس الكود بيشتغل مع AWS S3. |
| **Socket.io** | Polling | تحديثات لحظية بدون ضغط على السيرفر. |
| **Next.js** للويب | Flutter Web | أفضل للـ dashboards والـ SEO، ومطوّر الويب متخصص فيه. |
| **توليد الـ client من OpenAPI** | كتابة يدوية | 3 عملاء (ويب، موبايل، Postman) لازم يضلّوا متطابقين مع الباك. |

## بنية الباك إند

```
backend/
├── apps/
│   ├── api-gateway/src/
│   │   ├── common/          guards (JWT, Roles), decorators, error filter, clients
│   │   ├── auth/ users/ products/ orders/ notifications/ health/   ← controllers + DTOs
│   │   └── main.ts          helmet, CORS, ValidationPipe, Swagger
│   ├── users-service/       prisma/ + src/ (auth.service, users.service)
│   ├── products-service/    prisma/ + src/ (products, categories, storage=MinIO)
│   ├── orders-service/      prisma/ + src/ (orders.service: ownership + transitions)
│   └── notifications-service/ prisma/ + src/ (RMQ consumer + Socket.io gateway)
├── libs/common/src/         patterns, events, types, RPC helpers, client configs
├── test/api.e2e-spec.ts     اختبارات الأمان على النظام الحقيقي
└── Dockerfile               صورة وحدة لكل الخدمات (--build-arg APP=...)
```

## الأمان — طبقات الحماية

1. **Rate limiting** (Gateway): 120 طلب/دقيقة/IP عام، 10/دقيقة على مسارات الدخول.
2. **المصادقة** (Gateway): كل مسار بيحتاج JWT إلا اللي معلّم `@Public()`.
3. **الصلاحيات حسب الدور** (Gateway): `@Roles(Role.ADMIN)`.
4. **الملكية** (داخل الخدمة نفسها): orders-service و notifications-service بيتحققوا إن المورد للمستخدم. حتى لو انفتح خطأ بالـ Gateway، الخدمة بترفض (defense in depth).
5. **التحقق من المدخلات**: `whitelist + forbidNonWhitelisted`، فإرسال `"role": "ADMIN"` بالتسجيل بيترفض.
6. **قفل الحساب**: 5 محاولات فاشلة ← قفل 15 دقيقة (423). نفس رسالة الخطأ لإيميل غير موجود وكلمة سر غلط.
7. **الصور**: فحص نوع الملف من البايتات الأولى (magic bytes) مش من الامتداد، وحد 5MB.
8. **Helmet** (security headers)، **bcrypt** (12 rounds) لكلمات السر، **SHA-256** لتخزين الـ refresh token.

## صيغة الخطأ الموحدة

```json
{
  "success": false,
  "statusCode": 403,
  "error": "Forbidden",
  "message": "You do not have access to this order",
  "path": "/api/v1/orders/2b1c…",
  "method": "GET",
  "timestamp": "2026-10-28T19:23:31.710Z"
}
```

الخدمات بترمي `HttpException` عادية؛ `AllRpcExceptionsFilter` بينقلها عبر TCP مع الـ status code، و`sendRpc` بالـ Gateway بيرجّعها HttpException، و`HttpExceptionFilter` بيطلعها بالصيغة فوق. خدمة طافية ← 503.

## الـ Endpoints

كلها تحت `/api/v1`. التفاصيل الكاملة بـ Swagger.

| Method | Path | مين |
|---|---|---|
| POST | `/auth/register` · `/auth/login` · `/auth/refresh` | عام |
| POST | `/auth/logout` | مسجّل |
| GET/PATCH | `/users/me` | مسجّل |
| GET | `/users` · `/users/:id` | أدمن |
| GET | `/categories` | عام |
| POST/DELETE | `/categories` · `/categories/:id` | أدمن |
| GET | `/products` (pagination, search, categoryId, minPrice, maxPrice, inStock, sort) · `/products/:id` | عام |
| POST/PATCH/DELETE | `/products` · `/products/:id` | أدمن |
| POST/DELETE | `/products/:id/images` · `/products/:id/images/:imageId` | أدمن |
| PATCH | `/products/:id/stock` (`stock` أو `delta`) | أدمن |
| POST | `/orders` | زبون |
| GET | `/orders` (الزبون: طلباته بس) · `/orders/:id` (صاحبه أو أدمن) | مسجّل |
| PATCH | `/orders/:id/status` | أدمن |
| POST | `/orders/:id/cancel` (الزبون: طلبه وهو PENDING) | مسجّل |
| GET/PATCH | `/notifications` · `/notifications/:id/read` · `/notifications/read-all` | مسجّل |
| GET | `/health` | عام |

**حالات الطلب:** `PENDING → CONFIRMED → SHIPPED → DELIVERED`، والإلغاء مسموح من `PENDING` أو `CONFIRMED` (والمخزون بيرجع).

**WebSocket:** `io('http://localhost:3004', { auth: { token } })` ← event اسمه `notification`.

## ملاحظات للمتطلبات الجاية (الأداء والتوسع)

- الـ rate limiter حالياً بالذاكرة؛ مع أكتر من نسخة من الـ Gateway لازم ننقله لـ Redis.
- Socket.io مع أكتر من نسخة من notifications-service بيحتاج Redis adapter.
- الخدمات stateless (الصور بـ MinIO، الجلسات بالـ JWT)، فينفع نعمل `docker compose up --scale products-service=3` بعد ما نحط load balancer.
- MinIO ما عاد ينشر صور Docker عامة، فمستعملين صورة Bitnami لنفس الإصدار.
