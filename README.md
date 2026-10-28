# منصة تجارة إلكترونية — مشروع تطبيقات الإنترنت 2026

منصة مبنية من عدة خدمات (Microservices) تعمل معاً، مع لوحة تحكم ويب وتطبيق موبايل كامل.

| الجزء | التقنية | المجلد |
|---|---|---|
| الباك إند | NestJS (API Gateway + 4 خدمات) | [`backend/`](backend/) |
| لوحة التحكم (أدمن) + معلومات النظام + مختبر الأمان | Next.js | [`web/`](web/) |
| تطبيق الموبايل (متجر للزبون + وضع إدارة للأدمن) | Flutter | [`mobile/`](mobile/) |
| التوثيق | Swagger + Postman + المعمارية | [`docs/`](docs/) |

- 📖 **شرح المشروع للفريق (كيف بيشتغل كل جزء):** [docs/README.md](docs/README.md)
- 🎤 **سيناريو العرض قدام المعيد خطوة بخطوة:** [docs/DEMO.md](docs/DEMO.md)
- 📐 المعمارية وأسباب كل قرار: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- ✅ المتطلبات، وين تحققت، وكيف منثبتها: [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md)

---

## التشغيل

المتطلبات: Docker Desktop شغّال، و Node.js (لسكربت البيانات التجريبية).

```bash
docker compose up -d --build
```

بعد ما تشتغل الحاويات (أول مرة كم دقيقة)، عبّي بيانات تجريبية:

```bash
cd backend && npm run seed
```

| الرابط | شو هو |
|---|---|
| http://localhost:3001 | **لوحة التحكم** (ويب) |
| http://localhost:3000/docs | **Swagger**: توثيق وتجربة كل الـ API |
| http://localhost:3000/api/v1/health | حالة كل الخدمات |
| http://localhost:15672 | واجهة RabbitMQ (`app` / `app_password`) |
| http://localhost:9001 | واجهة MinIO للصور (`minio` / `minio_password`) |

**الحسابات التجريبية**

| الدور | الإيميل | كلمة السر |
|---|---|---|
| أدمن | `admin@shop.local` | `Admin@12345` |
| زبون | `ahmad@shop.local` | `Customer@123` |
| زبون | `sara@shop.local` | `Customer@123` |

ما في طريقة تسجّل أدمن من الـ API؛ حساب الأدمن بيتعمل تلقائياً أول ما تشتغل خدمة المستخدمين.

**الموبايل:** افتح مجلد `mobile` بـ Android Studio وشغّله على الـ emulator، أو من الترمينال:

```bash
cd mobile && flutter run
```

أوامر مفيدة:

```bash
docker compose ps                      # حالة الحاويات
docker compose logs -f orders-service  # لوغات خدمة معينة
docker compose down                    # إيقاف (البيانات بتضل)
docker compose down -v                 # إيقاف ومسح كل البيانات
```

## إثبات الأمان

بثلاث طرق:

1. **لوحة التحكم ← Security lab:** زر واحد بيشغّل 18 محاولة اختراق حقيقية ويعرض رد السيرفر على كل وحدة.
2. **تطبيق الموبايل ← Profile ← Security test:** نفس الفكرة من الموبايل، بتوكن المستخدم المسجّل.
3. **اختبارات آلية:**

```bash
cd backend && npm run test:e2e
```

34 اختبار على النظام الحقيقي. منها: زبون بيقرأ أو بيلغي طلب غيره ← **403**، زبون بيغيّر حالة طلب أو بيضيف منتج ← **403**، قفل الحساب بعد 5 محاولات ← **423**، rate limit ← **429**، 10 طلبات متزامنة على 3 قطع ← بالزبط 3 بتنجح.

> مسارات تسجيل الدخول محدودة بـ 20 طلب بالدقيقة لكل IP، فاستنى دقيقة بين كل تشغيلين للاختبارات. الاختبارات بتعمل حسابات `*@test.local`؛ لترجع البيانات نظيفة قبل العرض: `docker compose down -v`، بعدين `up` و `npm run seed`.

أو استورد [`docs/postman/ecommerce.postman_collection.json`](docs/postman/ecommerce.postman_collection.json) بـ Postman وشغّله بالـ Collection Runner. المجلد **5. Security proofs** فيه كل المحاولات المرفوضة.

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
| فلاتر 1 | `auth` + `products` + `cart` |
| فلاتر 2 | `orders` + `notifications` + `admin` + `security` |
| ويب | لوحة التحكم + صفحة System + Security lab |

**قاعدة الشغل:** أي ميزة جديدة بتبلّش بالـ DTO والـ Swagger بالـ gateway، وبعدين الفرونت بيشتغل عليها بالتوازي.
