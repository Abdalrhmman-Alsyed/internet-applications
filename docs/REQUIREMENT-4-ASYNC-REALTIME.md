# المتطلب الرابع: المعالجة غير المتزامنة والتحديث اللحظي

**الفكرة بجملة:** لما الزبون يعمل طلب، السيرفر بيرد عليه **فوراً**، وبيرمي "حدث" على RabbitMQ. بعدين:
- **عامل منفصل (email-worker)** بياخد الحدث ويبعت إيميل تأكيد حقيقي، بدون ما يضيع ولا رسالة حتى لو وقع.
- **notifications-service** بيبعت الحدث لحظياً لصفحة الأدمن، وتغييرات الحالة لصفحة تتبّع الزبون، بعد ما يتأكد مين انت وشو مسموحلك.

لتشغيل الإثبات كامل: `demo-4.cmd` (أو `cd backend && npm run demo:4`).

---

## 1. شو بالضبط المطلوب ← وين انعمل

| المطلوب | التنفيذ | الملف |
|---|---|---|
| عند إنشاء الطلب: نشر حدث والرد بدون انتظار | `this.events.emit('order.created', …)` بعد الحفظ، والرد مباشرة | `backend/apps/orders-service/src/orders.service.ts` |
| عامل منفصل يبعت إيميل حقيقي عبر خدمة بريد خارجية | حاوية `email-worker` (Node + amqplib + nodemailer) | `backend/apps/email-worker/src/main.ts`، `mailer.ts` |
| إعدادات الاتصال بملف إعدادات مش بالكود | `SMTP_HOST/PORT/USER/PASS/MAIL_FROM` من `.env` | `.env.example`، `docker-compose.yml` (خدمة email-worker) |
| ما في رسالة بتضيع: تأكيد بعد الإرسال | `channel.ack(msg)` **بعد** `sendMail` بس | `email-worker/src/main.ts` (دالة `handle`) |
| إعادة محاولة | نسخة بطابور `email.retry` مع `expiration` (5 ث، 30 ث، 2 د) وبترجع لحالها | `main.ts` + `libs/common/src/rabbit-topology.ts` |
| رسائل بتفشل دايماً ← DLQ (Dead Letter Exchange) | بعد 4 محاولات `nack(requeue=false)` ← `email.dlx` ← `email.dead` | `rabbit-topology.ts` (`x-dead-letter-exchange`) |
| صفحة تتبّع الطلب: الزبون بيشوف التغيير لحظياً بدون refresh، وما حدا غيره بيقدر يتابعه | صفحة `/track` + قناة `order:<id>` | `web/src/app/track/page.tsx`، `web/src/lib/realtime.tsx` |
| لوحة الأدمن: الطلب الجديد بيظهر فوراً، وبس الأدمن بيفوت | قناة `admin.orders` + صفحة Orders | `web/src/app/(dash)/orders/page.tsx` |
| التحقق من الهوية والصلاحية **قبل** الاشتراك بأي قناة | رسالة `subscribe`: تحقق من التوكن من جديد، بعدين الدور، بعدين الملكية (سؤال orders-service) | `backend/apps/notifications-service/src/notifications.gateway.ts` |
| لا تكتب WebSocket server من الصفر | Socket.io (`@nestjs/websockets` + `@nestjs/platform-socket.io`) | نفس الملف |

---

## 2. الرسم

```
 الزبون ──POST /orders──► Gateway ──TCP──► orders-service ──► DB (حفظ)
    ▲                                         │
    │ 201 فوراً (ما بيستنى الإيميل)            │ publish  routing key = order.created
    │                                         ▼
    │                         ┌──────── exchange "events" (topic) ────────┐
    │                         │                                           │
    │                         ▼ (نسخة)                                     ▼ (نسخة)
    │               email.order-created                          notifications.events
    │               (durable, DLX=email.dlx)                     (durable, DLX=notifications.dlx)
    │                    │          ▲                                     │
    │                    ▼          │ بعد المهلة                           ▼
    │               email-worker ──► email.retry (TTL لكل رسالة)    notifications-service
    │                │   │                                           │ يحفظ إشعار
    │       ack بعد  │   │ بعد 4 محاولات: nack                         │ Socket.io
    │       الإرسال  ▼   ▼                                           ▼
    │        SMTP (Mailpit / Mailtrap / Gmail)   email.dlx ─► email.dead   غرفة admin.orders ─► لوحة الأدمن
    │                                                                   غرفة order:<id>   ─► صفحة الزبون
    └──────────────────────────── order.status (لحظي) ◄──────────────────┘
```

**ليش exchange من نوع topic وطابور لكل مستهلك؟** لأنو عنا مستهلكين لنفس الحدث (الإيميل والإشعارات). لو كانوا على نفس الطابور، RabbitMQ بيوزّع الرسائل بيناتهم (كل رسالة لواحد بس). بطابور لكل واحد، كل واحد بياخد **نسخة**. وإذا الإيميل وقف، الإشعارات بتضل شغّالة.

---

## 3. ضمان عدم الضياع (أهم شي بالمتطلب)

| الخطر | الحماية |
|---|---|
| RabbitMQ بيعيد التشغيل أو بتنعاد الحاوية | الطوابير `durable` والرسائل `persistent` (`persistent: true` بالـ publisher)، على volume `rabbitmq_data` مع `hostname` ثابت. جرّبناها بـ `docker compose up -d --force-recreate rabbitmq` والرسالة ضلّت |
| العامل بيوقع أثناء الإرسال | **manual ack**: الرسالة ما بتنشال من الطابور إلا بعد `ack`. إذا انقطع الاتصال قبل الـ ack، RabbitMQ بيرجّعها |
| العامل موقّف كلياً | الرسائل بتتجمع بالطابور (شفنا 3 رسائل، 0 مستهلكين)، وأول ما يرجع بيبعتهم كلهم |
| السيرفر تبع الإيميل واقف | فشل ← نسخة بـ `email.retry` مع مهلة ← بترجع للطابور الأساسي ← محاولة جديدة |
| رسالة بتفشل دايماً (إيميل غلط، بيانات خربانة) | بعد 4 محاولات ← `email.dead`. ما بتعلّق الطابور، والأدمن بيقدر يشوفها ويعيدها |
| الإعادة ممكن تبعت الإيميل مرتين (at-least-once) | **idempotency**: علامة `email:sent:order:<id>` بـ Redis، والتكرار بيتنط |
| ضياع بين "حط نسخة بالـ retry" و "ack للأصلية" | **confirm channel**: منستنى `waitForConfirms()` (RabbitMQ أكّد إنو خزّن النسخة) وبعدين `ack` |

**ليش الـ retry بطابور منفصل مش `nack(requeue=true)`؟** لأنو `requeue=true` بيرجّع الرسالة **فوراً** لراس الطابور، فالعامل بيعيد المحاولة آلاف المرات بالثانية (حلقة ساخنة) وما في عدّاد محاولات. الطابور المنفصل مع `expiration` بيعطي **تأخير متزايد** (5 ث، 30 ث، 2 د) وعدّاد `x-attempt` بالـ headers.

**ليش email.retry ما إلو consumer؟** هو "غرفة انتظار" بس. لما تخلص مهلة الرسالة، RabbitMQ بيعملها dead-letter على الـ default exchange بـ routing key = `email.order-created`، فبترجع للطابور الأساسي لحالها.

---

## 4. القنوات اللحظية والصلاحيات

| القناة | مين بيقدر يشترك | شو بيوصل عليها |
|---|---|---|
| `admin.orders` | الأدمن بس (غيرو: 403) | `order.created` (طلب جديد) + `order.status` (أي تغيير حالة) |
| `order:<id>` | صاحب الطلب (أو الأدمن). غيرو: 403. id مش UUID: 400 | `order.status` لهالطلب بس |

**الخطوات عند الاشتراك** (`notifications.gateway.ts`، دالة `subscribe`):
1. **الهوية**: التوكن بيتحقق منه عند الاتصال (بدون توكن أو مزوّر ← الاتصال بينقطع، 401)، **وبيتحقق منه من جديد** عند كل اشتراك (لأنو ممكن يكون انتهى).
2. **الصلاحية**: لقناة الأدمن ← الدور لازم ADMIN.
3. **الملكية**: لقناة طلب ← منسأل orders-service بـ TCP `orders.find_one {user, id}`، وهو نفس الفحص يلي بيستعمله `GET /orders/:id`. يعني **قاعدة وحدة للملكية** بالـ REST وبالـ WebSocket.
4. بس بعد هيك: `client.join(room)`. والسيرفر هو يلي بيختار الغرفة، العميل ما بيقدر يكتب اسم غرفة بإيدو.

---

## 5. الإثبات (أرقام حقيقية من `demo-4`)

| التجربة | النتيجة |
|---|---|
| `POST /orders` | **201 خلال 40–230 ms**، والإيميل وصل بعد الرد بـ **~400 ms** |
| وقّفنا email-worker وعملنا 3 طلبات | الثلاثة 201، الطابور: **3 رسائل، 0 مستهلكين**، ولا إيميل |
| رجّعنا العامل | **الـ 3 إيميلات وصلوا**، الطابور رجع 0 |
| العامل واقف + رسالة بالطابور + إعادة إنشاء حاوية RabbitMQ | قبل: 1 رسالة، بعد: **1 رسالة**، شغّلنا العامل ← الإيميل وصل |
| وقّفنا Mailpit (سيرفر البريد) | محاولة 1 فشلت (Connection timeout) ← `email.retry` فيه 1 ← رجّعنا Mailpit ← **محاولة 2 نجحت** |
| `SIMULATE_EMAIL_FAILURE=always` | 4 محاولات (1 ث، 2 ث، 3 ث) ← `email.dead`: **0 ← 1**، و `x-death.reason = rejected` |
| إعادة الرسالة الميتة بعد الإصلاح | انبعت الإيميل |
| اتصال بدون توكن / بتوكن مزوّر | **مرفوض: الاتصال انسكّر (401)** |
| زبون ← `admin.orders` | **403** |
| سارة ← طلب أحمد | **403** |
| طلب جديد ← لوحة الأدمن | وصل خلال **27–65 ms** |
| الأدمن أكّد الطلب ← صفحة أحمد | وصل خلال **36–114 ms**، وسارة **ما وصلها شي** |
| الاختبارات الآلية | `npm run test:e2e` ← **43/43**، منهم 6 للمتطلب الرابع |

### بمتصفحين (المطلوب حرفياً)
1. متصفح عادي: http://localhost:3001 ← `admin@shop.local` ← Orders (فوق: **● Live: admin.orders**).
2. نافذة خفية (Incognito): نفس الرابط ← `ahmad@shop.local` ← بتفتح صفحة **My orders** (`/track`)، فيها **● live: order:…**.
3. بالنافذة الخفية: **Place a test order** ← بيطلع فوراً بالأدمن بشريط أخضر "New orders received live".
4. بالأدمن: افتح الطلب ← **Mark confirmed** ← بصفحة أحمد بيتغير الـ stepper لـ CONFIRMED وبيطلع سطر "live" بدون refresh.
5. بصفحة أحمد، خانة "Try to follow someone else's order": حط رقم طلب لسارة ← الجواب `403`.

- الإيميلات: http://localhost:8025 (Mailpit).
- الطوابير: http://localhost:15672 (app / app_password) ← Queues، أو صفحة **System** باللوحة.

---

## 6. خدمة البريد: Mailpit أو خدمة خارجية حقيقية

افتراضياً العامل بيبعت لـ **Mailpit** (حاوية فيها سيرفر SMTP وصندوق بريد على http://localhost:8025)، لحتى الديمو يشتغل بدون إنترنت وبدون حسابات. نفس الكود بيبعت لأي خدمة خارجية بتغيير `.env` بس:

```env
# Mailtrap (sandbox.smtp.mailtrap.io)
SMTP_HOST=sandbox.smtp.mailtrap.io
SMTP_PORT=2525
SMTP_USER=...
SMTP_PASS=...
```
بعدين: `docker compose up -d email-worker`. الكود ما بيتغير، وكلمة السر ما بتنكتب بالكود ولا بتنرفع على git (`.env` بالـ `.gitignore`).

---

## 7. بدائل ممكن يسأل عنها

| بدل | ليش ما استعملناه |
|---|---|
| نبعت الإيميل جوا `POST /orders` | الزبون بيستنى SMTP (ثواني)، وإذا البريد واقف الطلب بيفشل أو الإيميل بيضيع |
| `setTimeout` / Promise بدون انتظار جوا orders-service | إذا الخدمة وقعت، الشغل بيضيع (بالذاكرة بس) |
| Kafka | أقوى للـ streaming والإعادة من الأول، بس أثقل بكتير، وما فيه DLQ و per-message TTL جاهزين متل RabbitMQ |
| BullMQ (Redis) | ممتاز للـ jobs، بس RabbitMQ كان موجود عنا للأحداث، ومنستفيد من DLX |
| plugin `rabbitmq-delayed-message-exchange` | تأخير أنظف، بس بدو تثبيت plugin على السيرفر. الـ TTL + DLX شغّالين بدون شي إضافي |
| SSE أو polling بدل WebSocket | SSE باتجاه واحد (بيكفي هون فعلياً)، الـ polling بيضيّع طلبات وما بيكون لحظي. Socket.io عطانا غرف وإعادة اتصال وـ ack جاهزين |
| `ws` أو WebSocket خام | المتطلب صريح: لا تكتب سيرفر من الصفر. Socket.io جاهز |
| Pusher/Ably | خدمة خارجية مدفوعة، ونفس فكرة القنوات الخاصة (private channels + auth endpoint) |
