# المتطلب الثاني: التواصل بين الخدمات (gRPC)

> **المطلوب:** فصل إدارة المخزون بخدمة مستقلة، مكتوبة بلغة غير لغة التطبيق الأساسي (Polyglot)، إلها قاعدة بيانات لحالها، والتطبيق بيحكي معها بـ **gRPC** مباشرة.

## شو عملنا

| المطلوب | التنفيذ |
|---|---|
| خدمة مستقلة بلغة تانية | [`inventory-service/`](../inventory-service/) مكتوبة بـ **Go**، والباقي NestJS |
| قاعدة بيانات خاصة | `inventory_db` (جداول `stock` و `reservations` و `closed_reservations`) |
| ملف proto | [`proto/inventory.proto`](../proto/inventory.proto): `CheckStock` و `ReserveStock` و `ReleaseStock`، وعمليتين للأدمن (`SetStock` و `ListStock`) |
| عرض تفاصيل المنتج | products-service بيسأل `CheckStock` وبيرجّع `stock` مع المنتج، **بطلب واحد لكل الصفحة** (مش طلب لكل منتج) |
| إنشاء الطلب | orders-service بيبعت `ReserveStock` واحد بكل العناصر: يا بينحجز الكل يا ولا شي. إذا رفض، ما بينعمل الطلب |
| الكمية غير كافية | **409** "Insufficient stock for "Desk Lamp" (only 0 left)" |
| المخزون متوقف أو بطيء | مهلة (deadline) **ثانيتين** لكل طلب gRPC، وبعدها **503** (متوقف) أو **504** (بطيء) برسالة واضحة |
| حجز وفشل الحفظ | `ReleaseStock` تلقائياً (compensation)، مع إعادة محاولة بالخلفية |

```
Flutter / Next.js ─HTTP─► API Gateway ─TCP─► orders-service ──gRPC (deadline 2s)──► inventory-service (Go)
                                         └──TCP─► products-service ──gRPC──────────┘        │
                                                                                      inventory_db
```

## ليش gRPC؟ وليش Go؟

- **gRPC:** خدمة Go ما بتفهم بروتوكول TCP الخاص بـ NestJS. gRPC بيشتغل بين أي لغتين، والعقد (`.proto`) مكتوب بمكان واحد وبيتولّد منه كود للطرفين، فما في اختلاف بشكل البيانات. وكمان بيانات ثنائية (أصغر وأسرع من JSON) فوق HTTP/2، وفيه **deadlines** و**رموز أخطاء** جاهزة (`FAILED_PRECONDITION`، `DEADLINE_EXCEEDED`، `UNAVAILABLE`…).
- **Go:** أفضل دعم لـ gRPC (هي لغة gRPC الأصلية)، سريعة، الـ goroutines بتخلي التزامن سهل، وبتطلع **binary واحد** بصورة Docker صغيرة (distroless، بدون shell، مستخدم مش root).

## كيف بيمشي الطلب

1. orders-service بيجيب **الأسماء والأسعار** من products-service (TCP).
2. بيولّد رقم الطلب (UUID)، وبيستعمله كمان **رقم الحجز**.
3. `ReserveStock(reservation_id, items)` عبر gRPC مع deadline ثانيتين.
4. خدمة Go بتفتح **transaction**، وبترتّب العناصر حسب رقم المنتج، ولكل عنصر:
   ```sql
   UPDATE stock SET quantity = quantity - $2
   WHERE product_id = $1 AND quantity >= $2
   RETURNING quantity
   ```
   إذا عنصر واحد ما كفى، الـ transaction كلها بترجع: **ولا شي بينحجز**.
5. بيحفظ الطلب. إذا فشل الحفظ: `ReleaseStock(order_id)`.
6. الإلغاء (من الزبون أو الأدمن): `ReleaseStock(order_id)` بيرجّع بالضبط اللي انحجز لهالطلب.

## حالات الفشل

| الحالة | شو بيصير | ليش هيك |
|---|---|---|
| الكمية مش كافية | Go بترجع `FAILED_PRECONDITION` ومعها `product-id` و `available` بالـ trailers، و orders-service بيحوّلها لـ **409** باسم المنتج | المستخدم بيعرف أي منتج خلص وكم باقي |
| الخدمة متوقفة | بعد ثانيتين بالكتير: **503** "Inventory service is unreachable" | **deadline** على كل طلب gRPC، فما في انتظار للأبد |
| الخدمة بطيئة | بعد ثانيتين بالضبط: **504** "did not answer within 2000 ms". وGo نفسها بتوقف الشغل لأنو الـ deadline بيوصلها (**deadline propagation**) | الـ context بـ Go بينلغى لما المتصل يستسلم |
| انتهت المهلة، بس يمكن انحجز؟ | منبعت `ReleaseStock` بالخلفية. هو **idempotent**، ولو وصل قبل الحجز، الحجز المتأخر بينرفض (`closed_reservations` + قفل `pg_advisory_xact_lock`) | ما في مخزون بيضيع "معلّق" |
| حجز نجح وفشل حفظ الطلب | `ReleaseStock` مع إعادة محاولة (1، 2، 4، 8 ثواني) | compensation (فكرة الـ Saga) |
| عرض المنتجات والمخزون متوقف | المنتجات بتنعرض، و `stock: 0` و `inventoryAvailable: false`، والموبايل بيكتب "معلومات المخزون غير متاحة حالياً" | التصفح ما لازم يوقف لأنو خدمة ثانوية وقعت (graceful degradation) |

## الإثبات (أرقام حقيقية من تشغيلنا)

### 1. السباق على آخر قطعة

```bash
cd backend
npm run demo:race
```

```
"Desk Lamp": stock set to 1. Sending 10 orders at the same moment...

  # 1  201     35 ms  order placed
  # 2  409     33 ms  Insufficient stock for "Desk Lamp" (only 0 left)
  # 3  409     78 ms  Insufficient stock for "Desk Lamp" (only 0 left)
  ...
  #10  409     78 ms  Insufficient stock for "Desk Lamp" (only 0 left)

✔ 1 succeeded, 9 rejected with 409. Stock now: 0
```

**ليش بينجح واحد بس؟** Postgres بيقفل الصف وقت الـ `UPDATE`. الطلب التاني بيستنى لحد ما يخلص الأول، وبعدها بيعيد فحص `quantity >= 1` على القيمة الجديدة (0) فبيفشل. يعني الفحص والتنقيص **عملية وحدة ذرّية**، مش "اقرأ بعدين اكتب".

### 2. خدمة المخزون متوقفة / بطيئة

```bash
docker compose stop inventory-service        # أو: خدمة بطيئة بـ INVENTORY_LATENCY_MS=3000
cd backend && npm run demo:order
```

| الحالة | الرد | الوقت |
|---|---|---|
| الخدمة متوقفة | **503** "Inventory service is unavailable. Please try again shortly." | 1.5 ثانية |
| الخدمة بطيئة (3 ثواني لكل طلب، والمهلة ثانيتين) | **504** "Inventory service did not answer within 2000 ms. Please try again." | **2.0 ثانية بالضبط** |
| رجعت طبيعية | **201** الطلب انعمل | 41 ms |

بالحالة البطيئة، لوغات خدمة Go بتبيّن إنها هي كمان وقفت لما المتصل استسلم (deadline propagation):

```
level=WARN msg="caller gave up" method=/inventory.v1.InventoryService/ReserveStock after=2s
```

وبكل الحالات الرد بالصيغة الموحّدة للأخطاء (`success`, `statusCode`, `error`, `message`, `path`…).

### 3. اختبارات آلية

`npm run test:e2e` (37 اختبار)، منها 3 للمتطلب الثاني: الكمية جاية من خدمة المخزون، والسباق على آخر قطعة (1 بينجح و 9 بياخدوا 409 برسالة واضحة)، و"الكل أو لا شي" (طلب فيه منتج خلص ما بيحجز ولا شي من الباقي).

## جرّبها بـ grpcurl (اختياري)

الخدمة مفعّل فيها **reflection**، فـ grpcurl بيعرف العمليات لحاله:

```bash
grpcurl -plaintext localhost:50051 list inventory.v1.InventoryService
grpcurl -plaintext -d '{"product_ids":["<uuid>"]}' localhost:50051 inventory.v1.InventoryService/CheckStock
```

## أسئلة متوقعة

| السؤال | الجواب |
|---|---|
| ليش ما خليتو المخزون بخدمة المنتجات؟ | المتطلب طالب فصله. وكمان المخزون بيتغيّر كتير (كل طلب)، والمنتجات نادراً. الفصل بيخلي كل وحدة تتوسع لحالها، وما بيصير قفل على جدول المنتجات وقت الحجز. |
| شو الفرق بين gRPC و REST؟ | REST: JSON نصي، وأي شكل للـ URL، وما في عقد إجباري. gRPC: عقد `.proto` صارم بيتولّد منه الكود، بيانات ثنائية، HTTP/2، و deadlines ورموز أخطاء موحّدة. REST أحسن للمتصفح والعموم، و gRPC أحسن بين الخدمات. |
| ليش المتصفح ما بيحكي gRPC مباشرة؟ | المتصفحات ما بتدعم gRPC الخام (بدها gRPC-Web وبروكسي). فالعملاء بيحكوا REST مع الـ Gateway، و gRPC جوا بين الخدمات. |
| كيف بتمنع بيع آخر قطعة مرتين؟ | `UPDATE … WHERE quantity >= n` جوا transaction: الفحص والتنقيص بأمر واحد، و Postgres بيقفل الصف. ومنعت الـ deadlock بترتيب العناصر حسب رقم المنتج. وكمان `CHECK (quantity >= 0)` بالجدول. |
| شو هو الـ deadline؟ | أقصى وقت المتصل مستعد يستنى. بعده gRPC بيلغي الطلب بالطرفين. عنا ثانيتين للحجز، وثانية لعرض الكمية. |
| إذا انتهت المهلة والحجز صار فعلاً؟ | منبعت `ReleaseStock` لنفس رقم الحجز. هو idempotent (مرتين = مرة)، وبيسكّر الرقم، فلو وصل الحجز المتأخر بعده بينرفض. فما في مخزون معلّق. |
| ليش رقم الطلب هو نفسه رقم الحجز؟ | لحتى الإلغاء يرجّع بالضبط اللي انحجز لهالطلب، ولحتى إعادة المحاولة ما تحجز مرتين (idempotency). |
| ليش Go ومش Python؟ | دعم gRPC أصلي، أسرع، binary واحد وصورة صغيرة، والتزامن (goroutines) سهل. |
| كيف بتولّد كود gRPC؟ | بـ Go: `protoc` جوا الـ Dockerfile بيولّد `gen/inventoryv1`. بـ NestJS: `@grpc/proto-loader` بيقرأ نفس الملف وقت التشغيل. |
| شو بيصير للمنتجات إذا المخزون وقع؟ | بتضل تنعرض (`inventoryAvailable: false`)، بس الطلب بيرجع 503 لحد ما ترجع الخدمة. |
