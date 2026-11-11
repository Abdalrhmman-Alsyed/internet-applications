# سيناريو العرض قدام المعيد

قبل العرض (مرة وحدة):

```bash
docker compose down -v
docker compose up -d --build
cd backend && npm run seed
```

افتح: لوحة التحكم http://localhost:3001، والـ emulator عليه التطبيق، و Swagger http://localhost:3000/docs.

---

## 1. المعمارية (دقيقة)

**لوحة التحكم ← System**

- الخدمات الأربعة شغّالة، وجنب كل وحدة سرعة الرد (TCP)، وكل خدمة إلها قاعدة بيانات لحالها.
- مخطط المعمارية: Gateway ← خدمات ← RabbitMQ / PostgreSQL / MinIO.
- **Event queue**: عدد الرسائل المنشورة والمعالَجة على RabbitMQ (معالجة غير متزامنة).
- **Security configuration**: JWT، rate limit، قفل الحساب، bcrypt.
- **API endpoints**: كل الـ endpoints، وجنب كل واحد مين مسموحله (Public / Signed in / Customer / Admin).

ورجيه كمان `docker compose ps`: كل المشروع شغّال بـ Docker.

## 2. الوظائف (دقيقتين)

**على الموبايل، سجّل دخول كـ Ahmad:**

1. Shop: منتجات مع صور، فلترة حسب التصنيف، بحث، ترتيب.
2. افتح منتج ← Add to cart ← Cart ← **Place order**.
3. لاحظ الإشعار اللحظي "Order received" (Socket.io).

**على لوحة التحكم كأدمن:**

4. Overview: الطلب الجديد ظهر لحالو، والأرقام تحدّثت.
5. Orders ← افتح طلب Ahmad ← **Mark confirmed**.
6. **على الموبايل:** الإشعار "Order update" بيوصل فوراً، وشاشة الطلب بتتحدث لحالها (Tracking).
7. Products ← عدّل مخزون منتج، أو ارفع صورة.

## 3. الأمان: رفض تجاوز الصلاحيات (الأهم)

### من الموبايل (Ahmad = زبون)

**Profile ← Security test ← Run all**

كل الطلبات بتنبعت **بتوكن Ahmad الحقيقي**:

| المحاولة | النتيجة |
|---|---|
| يفتح طلب Sara | **403** |
| يلغي طلب Sara | **403** |
| يغيّر حالة طلب لـ DELIVERED | **403** |
| يضيف منتج | **403** |
| يشوف قائمة المستخدمين / الإحصائيات / معلومات النظام | **403** |
| يعلّم إشعار Sara كمقروء | **403** |
| بدون توكن / بتوكن مزوّر فيه role ADMIN | **401** |
| يسجّل حساب ومعه `"role": "ADMIN"` | **400** |
| Sara تفتح طلبها هي (للمقارنة) | **200** ✅ |

افتح أي سطر لتشوف رد السيرفر كامل بالصيغة الموحّدة للأخطاء.

**الفكرة اللي لازم توصلها:** حتى لو حدا عدّل التطبيق وطلّع أزرار الأدمن، السيرفر بيرفض، لأن الحماية بالباك إند مش بالواجهة.

### من لوحة التحكم

**Security lab ← Run all attacks**: 18 فحص، والنتيجة `18 / 18 checks behaved as expected`.

- **Brute-force**: 5 كلمات سر غلط، وبعدها حتى كلمة السر الصح بترجع **423 Locked**.
- **Rate limiting**: طلبات متتالية لحتى يرجع **429**. ⚠️ هاد بيقفل تسجيل الدخول من هالجهاز لدقيقة، فخليه آخر شي.

### زبون بيحاول يفوت على لوحة التحكم

سجّل خروج من الويب وادخل كـ `ahmad@shop.local`. بتطلع شاشة **Access denied**، وتحتها رد السيرفر الحقيقي (403) على طلب admin بتوكن Ahmad. يعني الرفض من السيرفر نفسه، مش بس الواجهة مخفية.

### Swagger

`POST /auth/login` كـ Ahmad ← Authorize ← جرّب `PATCH /orders/{id}/status` ← **403**.

## 4. المتطلب الثاني: خدمة المخزون (Go + gRPC)

التفاصيل والأسئلة المتوقعة: [REQUIREMENT-2-GRPC.md](REQUIREMENT-2-GRPC.md).

1. **ورجيه إنها خدمة لحالها بلغة تانية:** `docker compose ps` (فيه `inventory-service`)، وصفحة **System** باللوحة (inventory: gRPC 50051 · Go)، وافتح `proto/inventory.proto` (العقد) و `inventory-service/store.go` (الحجز).
2. **عرض المنتج:** افتح منتج بالموبايل، الكمية جاية من خدمة المخزون (`GET /products/{id}` ← `stock`، `inventoryAvailable: true`).
3. **الحجز وقت الطلب:** اعمل طلب. بلوغات Go بتشوف `ReserveStock`:
   ```bash
   docker compose logs -f inventory-service
   ```
4. **السباق على آخر قطعة (الأهم):**
   ```bash
   cd backend
   npm run demo:race
   ```
   10 طلبات بنفس اللحظة على قطعة وحدة: **1 بينجح (201) و 9 بيترفضوا (409)** برسالة "Insufficient stock for …". السكربت بيرجّع كل شي متل ما كان.
5. **خدمة المخزون متوقفة:**
   ```bash
   docker compose stop inventory-service
   cd backend && npm run demo:order
   ```
   الرد **503** خلال ثانيتين: "Inventory service is unreachable"، مش انتظار للأبد. والمنتجات لسا بتنعرض، والموبايل بيكتب "معلومات المخزون غير متاحة حالياً". بعدها رجّعها: `docker compose up -d inventory-service`.
6. **(اختياري) خدمة بطيئة:** بـ PowerShell `$env:INVENTORY_LATENCY_MS=3000; docker compose up -d inventory-service`، والطلب بيرجع **504** بعد ثانيتين بالضبط. ورجّعها: `Remove-Item Env:INVENTORY_LATENCY_MS; docker compose up -d inventory-service`.

## 5. المتطلب الثالث: الأداء والتخزين المؤقت

التفاصيل والأرقام والأسئلة المتوقعة: [REQUIREMENT-3-PERFORMANCE.md](REQUIREMENT-3-PERFORMANCE.md).

1. **حجم البيانات:** بـ pgAdmin أو psql: `SELECT count(*) FROM orders;` ← حوالي 300 ألف.
2. **جدول قبل وبعد:**
   ```bash
   cd backend
   npm run perf:compare
   ```
   p95: 848 ms ← 136 ms، والطلبات/ثانية ×3.
3. **EXPLAIN:** بـ orders_db شغّل:
   ```sql
   EXPLAIN ANALYZE SELECT * FROM orders WHERE status = 'PENDING' ORDER BY "createdAt" DESC LIMIT 20;
   ```
   بيطلع `Index Scan using "orders_status_createdAt_idx"` وأقل من 1 ms. احكي إنو كان 18 ms مع Sort على 42 ألف صف.
4. **Redis:** `docker compose exec redis redis-cli --scan --pattern 'catalog:*'` بيعرض المفاتيح. و `redis-cli INFO stats` بيعرض الإصابات.
5. **ETag:** افتح منتج مرتين بالمتصفح (DevTools ← Network)، المرة التانية **304**. أو بـ curl مع `If-None-Match`.
6. **تعديل منتج بيظهر فوراً:** عدّل سعر من اللوحة، وافتحه بالموبايل، السعر الجديد مباشرة.
7. **نسخة القراءة و read-your-writes (الأقوى):**
   ```powershell
   $env:REPLICA_DELAY_MS=3000; docker compose up -d postgres-replica
   cd backend; npm run perf:ryw
   ```
   بيبيّن إنو النسخة متأخرة فعلاً، وأحمد بيشوف طلبه فوراً، والأدمن ما بيشوفه لسا. بعدها رجّعها: `Remove-Item Env:REPLICA_DELAY_MS; docker compose up -d postgres-replica`.
8. **(إذا في وقت) اختبار ضغط مباشر:** `npm run perf:test -- live` (دقيقة).

## 6. أسئلة متوقعة

| السؤال | الجواب |
|---|---|
| وين بتتحقق الصلاحيات؟ | بطبقتين: الـ Gateway (`@Roles` + JWT guard)، وجوا الخدمة نفسها (ملكية الطلب، دور المستخدم). |
| ليش 403 مش 404 لطلب غيرك؟ | 403 بيوضح للمعيد إنو الرفض بسبب الصلاحية. فينا نغيّرها لـ 404 إذا بدنا نخفي إنو الطلب موجود. |
| شو بصير إذا انسرق التوكن؟ | الـ access token عمره 15 دقيقة. الـ refresh بينستعمل مرة وحدة، وإعادة استعماله بتلغي الجلسة. |
| كيف بتمنع بيع آخر قطعة مرتين؟ | `UPDATE ... WHERE stock >= qty` جوا transaction. الاختبار بيبعت 10 طلبات متزامنة على 3 قطع، وبتنجح 3 بالزبط. |
| ليش RabbitMQ؟ | الإشعارات ما بتأخّر رد الطلب، والرسالة بتنحفظ إذا خدمة الإشعارات طافية (durable + manual ack). |
