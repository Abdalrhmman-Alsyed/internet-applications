# Web (Next.js)

المتجر + لوحة تحكم الأدمن. بيشتغل على http://localhost:3001

```bash
npm install
cp .env.example .env.local
npm run dev
```

## الـ API

- `src/lib/api/schema.d.ts`: **مولّد تلقائياً** من Swagger الباك إند، لا تعدّله يدوياً.
  بعد أي تغيير بالباك (والـ stack شغّال): `npm run gen:api`
- `src/lib/api/client.ts`: client بـ types كاملة:

```ts
const { data, error } = await api.GET('/api/v1/products', {
  params: { query: { categoryId, page: 1, limit: 20 } },
});
```

أي path أو body غلط بيطلع خطأ TypeScript قبل ما يوصل للسيرفر.

## البنية المقترحة

```
src/app/
├── (shop)/          المتجر: products, products/[id], cart, orders, login, register
├── admin/           لوحة الأدمن: products, inventory, orders, users (محمية بدور ADMIN)
src/components/      مكونات مشتركة
src/lib/api/         الـ client والـ types
```

الإشعارات اللحظية: `socket.io-client` على `http://localhost:3004` مع `auth: { token }`، والـ event اسمه `notification`.
