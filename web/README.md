# Web (Next.js): لوحة التحكم

لوحة تحكم للأدمن على http://localhost:3001. تشتغل مع `docker compose up`، أو محلياً:

```bash
npm install
cp .env.example .env.local
npm run dev
```

## الصفحات

| الصفحة | شو فيها |
|---|---|
| `/login` | تسجيل الدخول. زبون بيسجّل دخول بيشوف **Access denied** مع رد السيرفر 403 الحقيقي |
| `/` Overview | الإيرادات، الطلبات حسب الحالة، آخر 7 أيام، المخزون المنخفض، آخر الطلبات. بتتحدّث لحالها مع الإشعارات اللحظية |
| `/orders` | كل الطلبات مع فلترة حسب الحالة، وتفاصيل الطلب وتاريخه، وأزرار الانتقالات المسموحة بس |
| `/products` | إضافة وتعديل المنتجات، رفع وحذف الصور، تعديل المخزون، إخفاء واسترجاع |
| `/categories` | إضافة وحذف التصنيفات |
| `/users` | المستخدمين مع بحث وفلترة حسب الدور |
| `/notifications` | الإشعارات (من RabbitMQ، بتوصل لحظياً بـ Socket.io) |
| `/system` | **معلومات الباك إند الحية:** حالة الخدمات وسرعتها، المعمارية، إحصائيات الطابور، إعدادات الأمان، وكل الـ endpoints مقروءة من Swagger |
| `/security` | **Security lab:** محاولات حقيقية لتجاوز الصلاحيات مع رد السيرفر، و brute-force و rate limit |

## البنية

```
src/
├── app/
│   ├── login/            صفحة الدخول
│   └── (dash)/           كل صفحات لوحة التحكم (محمية بدور ADMIN)
├── components/           ui.tsx (Button, Card, Modal, Table…), sidebar, toasts
└── lib/
    ├── api.ts            fetch + التوكنات + refresh تلقائي عند 401 + ApiError
    ├── auth.tsx          AuthProvider (login / logout / المستخدم الحالي)
    ├── realtime.tsx      اتصال Socket.io بالإشعارات
    ├── use-api.ts        hook لجلب البيانات
    └── types.ts          أنواع البيانات + انتقالات حالة الطلب
```
