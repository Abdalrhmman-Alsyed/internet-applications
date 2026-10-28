# منصة تجارة إلكترونية — مشروع تطبيقات الإنترنت 2026

منصة مبنية من عدة خدمات (Microservices) تعمل معاً، مع واجهة ويب وتطبيق موبايل.

| الجزء | التقنية | المجلد |
|---|---|---|
| الباك إند | NestJS (API Gateway + 4 خدمات) | [`backend/`](backend/) |
| الويب (المتجر + لوحة الأدمن) | Next.js | [`web/`](web/) |
| الموبايل (تطبيق الزبون + وضع أدمن خفيف) | Flutter | [`mobile/`](mobile/) |
| التوثيق | Swagger + Postman + المعمارية | [`docs/`](docs/) |

- 📐 المعمارية وأسباب كل قرار: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- ✅ المتطلبات وأين تحققت وكيف نثبتها بالمقابلة: [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md)

---

## التشغيل بأمر واحد

المتطلبات: Docker Desktop شغّال.

```bash
docker compose up -d --build
```

أول مرة بياخد كم دقيقة. بعدها:

| الرابط | شو هو |
|---|---|
| http://localhost:3000/docs | **Swagger** — توثيق وتجربة كل الـ API |
| http://localhost:3000/api/v1/health | حالة كل الخدمات |
| http://localhost:3001 | الويب |
| http://localhost:15672 | واجهة RabbitMQ (`app` / `app_password`) |
| http://localhost:9001 | واجهة MinIO للصور (`minio` / `minio_password`) |

**حساب الأدمن الجاهز:** `admin@shop.local` / `Admin@12345`
(ما في طريقة تسجّل أدمن من الـ API — بيتعمل تلقائياً أول ما تشتغل خدمة المستخدمين.)

أوامر مفيدة:

```bash
docker compose ps                      # حالة الحاويات
docker compose logs -f orders-service  # لوغات خدمة معينة
docker compose down                    # إيقاف (البيانات بتضل)
docker compose down -v                 # إيقاف ومسح كل البيانات
```

## إثبات الأمان (للمقابلة)

مع تشغيل الـ stack:

```bash
cd backend && npm install && npm run test:e2e
```

32 اختبار على النظام الحقيقي، منها: زبون بيحاول يقرأ/يلغي طلب غيره ← **403**، زبون بيحاول يغيّر حالة طلب أو يضيف منتج ← **403**، قفل الحساب بعد 5 محاولات ← **423**، rate limit ← **429**، 10 طلبات متزامنة على 3 قطع ← بالزبط 3 بتنجح.

> مسارات تسجيل الدخول محدودة بـ 10 طلبات بالدقيقة لكل IP، فاستنى دقيقة بين كل تشغيلين للاختبارات.

أو استورد [`docs/postman/ecommerce.postman_collection.json`](docs/postman/ecommerce.postman_collection.json) بـ Postman وشغّله بالـ Collection Runner — المجلد **5. Security proofs** فيه كل المحاولات المرفوضة.

## التطوير المحلي (بدون بناء الصور كل مرة)

```bash
docker compose up -d postgres rabbitmq minio   # البنية التحتية بس
cd backend
cp .env.example .env
npm install
npm run prisma:migrate
npm run start:dev -- users-service             # كل خدمة بترمينال لحالها
npm run start:dev -- products-service
npm run start:dev -- orders-service
npm run start:dev -- notifications-service
npm run start:dev -- api-gateway
```

الويب: `cd web && npm install && npm run dev` ← http://localhost:3001
الموبايل: شوف [mobile/README.md](mobile/README.md)

## توزيع الفريق

| الشخص | المسؤولية |
|---|---|
| باك 1 | `api-gateway` + `users-service` (المصادقة والأمان) + `notifications-service` |
| باك 2 | `products-service` (صور، تصنيف، مخزون) + `orders-service` + أحداث RabbitMQ |
| فلاتر 1 | المصادقة + تصفح المنتجات + السلة |
| فلاتر 2 | الطلبات + الإشعارات اللحظية + وضع الأدمن |
| ويب | لوحة الأدمن + المتجر |

**قاعدة الشغل:** أي ميزة جديدة بتبلّش بالـ DTO والـ Swagger بالـ gateway، وبعدين الفرونت بيولّد الـ types (`npm run gen:api` بالويب) ويشتغل بالتوازي مع الباك.
