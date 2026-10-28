// Demo data through the public API (so every rule, validation and event runs):
//   npm run seed          (stack must be running: docker compose up -d)
// Safe to run again: existing data is reused, nothing is duplicated.
import { deflateSync } from 'node:zlib';

const API = process.env.API_URL ?? 'http://localhost:3000/api/v1';
const ADMIN = { email: process.env.ADMIN_EMAIL ?? 'admin@shop.local', password: process.env.ADMIN_PASSWORD ?? 'Admin@12345' };
const PASSWORD = 'Customer@123';
const CUSTOMERS = [
  { email: 'ahmad@shop.local', name: 'Ahmad Ali', phone: '+963911111111' },
  { email: 'sara@shop.local', name: 'Sara Hasan', phone: '+963922222222' },
];

const CATALOG = {
  Electronics: [
    ['Wireless Headphones', 'Bluetooth 5.3, active noise cancelling, 30h battery', 59.99, 25],
    ['Smart Watch', 'Heart-rate, GPS and sleep tracking, 7-day battery', 129.0, 12],
    ['Power Bank 20000mAh', 'Fast charging USB-C PD 22.5W', 34.5, 40],
    ['Mechanical Keyboard', 'Hot-swappable switches, RGB backlight', 89.0, 4],
  ],
  Fashion: [
    ['Leather Jacket', 'Genuine leather, slim fit', 149.0, 8],
    ['Running Shoes', 'Lightweight mesh, cushioned sole', 74.99, 30],
    ['Classic Sunglasses', 'UV400 polarised lenses', 24.0, 50],
  ],
  Home: [
    ['Coffee Maker', '12-cup programmable drip machine', 45.0, 15],
    ['Desk Lamp', 'LED, 3 colour temperatures, USB charging port', 27.5, 3],
    ['Throw Pillow Set', 'Set of 2, washable covers', 19.99, 60],
  ],
  Books: [
    ['Clean Code', 'A handbook of agile software craftsmanship', 32.0, 20],
    ['Designing Data-Intensive Applications', 'The big ideas behind reliable, scalable systems', 44.0, 2],
  ],
};

// ─── Tiny PNG generator (gradient + circle), no dependencies ───
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};
const hsl = (h, s, l) => {
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const k = (n + h / 30) % 12;
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return [f(0), f(8), f(4)];
};
function productImage(hue, size = 320) {
  const raw = Buffer.alloc((size * 3 + 1) * size);
  const [cx, cy, r] = [size / 2, size / 2, size * 0.28];
  for (let y = 0; y < size; y++) {
    const row = y * (size * 3 + 1);
    raw[row] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const inCircle = (x - cx) ** 2 + (y - cy) ** 2 < r * r;
      const [R, G, B] = inCircle ? hsl((hue + 40) % 360, 0.7, 0.85) : hsl(hue, 0.65, 0.35 + (0.25 * (x + y)) / (2 * size));
      raw.set([R, G, B], row + 1 + x * 3);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.set([8, 2, 0, 0, 0], 8); // 8-bit RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ─── API helper ───
async function api(method, path, { token, body, form } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${API}${path}`, { method, headers, body: form ?? (body ? JSON.stringify(body) : undefined) });
  const data = await res.json().catch(() => undefined);
  return { status: res.status, data };
}
function must(res, what) {
  if (res.status >= 400) throw new Error(`${what} failed (${res.status}): ${JSON.stringify(res.data?.message)}`);
  return res.data;
}

async function main() {
  const health = await api('GET', '/health').catch(() => ({ status: 0 }));
  if (health.status !== 200) throw new Error(`API not reachable at ${API}. Start it with: docker compose up -d`);

  const admin = must(await api('POST', '/auth/login', { body: ADMIN }), 'Admin login').accessToken;
  console.log('✔ Logged in as admin');

  // Customers (register, or log in if they already exist)
  const customers = [];
  for (const c of CUSTOMERS) {
    let res = await api('POST', '/auth/register', { body: { ...c, password: PASSWORD } });
    if (res.status === 409) res = await api('POST', '/auth/login', { body: { email: c.email, password: PASSWORD } });
    customers.push({ ...c, token: must(res, `Customer ${c.email}`).accessToken });
  }
  console.log(`✔ Customers: ${CUSTOMERS.map((c) => c.email).join(', ')}  (password ${PASSWORD})`);

  // Categories
  const existingCats = must(await api('GET', '/categories'), 'List categories');
  const catIds = {};
  for (const name of Object.keys(CATALOG)) {
    const found = existingCats.find((c) => c.name === name);
    catIds[name] = found?.id ?? must(await api('POST', '/categories', { token: admin, body: { name } }), `Category ${name}`).id;
  }
  console.log(`✔ Categories: ${Object.keys(CATALOG).join(', ')}`);

  // Products + images
  const products = [];
  let hue = 0;
  for (const [cat, items] of Object.entries(CATALOG)) {
    for (const [name, description, price, stock] of items) {
      hue = (hue + 31) % 360;
      const search = must(await api('GET', `/products?search=${encodeURIComponent(name)}&limit=5`, { token: admin }), 'Search');
      let product = search.data.find((p) => p.name === name);
      if (!product) {
        product = must(await api('POST', '/products', { token: admin, body: { name, description, price, stock, categoryId: catIds[cat] } }), `Product ${name}`);
      }
      if (!product.images?.length) {
        const form = new FormData();
        form.append('file', new Blob([productImage(hue)], { type: 'image/png' }), 'product.png');
        must(await api('POST', `/products/${product.id}/images`, { token: admin, form }), `Image for ${name}`);
      }
      products.push(product);
    }
  }
  console.log(`✔ Products: ${products.length} (with images)`);

  // Orders in different states, so the dashboard and apps have something to show
  const byName = (n) => products.find((p) => p.name === n).id;
  const plans = [
    { who: 0, items: [['Wireless Headphones', 1], ['Power Bank 20000mAh', 2]], to: [] },
    { who: 0, items: [['Clean Code', 1]], to: ['CONFIRMED', 'SHIPPED', 'DELIVERED'] },
    { who: 1, items: [['Smart Watch', 1]], to: ['CONFIRMED'] },
    { who: 1, items: [['Running Shoes', 1], ['Classic Sunglasses', 1]], to: ['CONFIRMED', 'SHIPPED'] },
    { who: 1, items: [['Coffee Maker', 1]], to: ['CANCELLED'] },
  ];
  let created = 0;
  for (const [i, c] of customers.entries()) {
    const mine = must(await api('GET', '/orders?limit=1', { token: c.token }), 'My orders');
    if (mine.meta.total > 0) continue;
    for (const plan of plans.filter((p) => p.who === i)) {
      const order = must(
        await api('POST', '/orders', {
          token: c.token,
          body: { items: plan.items.map(([n, quantity]) => ({ productId: byName(n), quantity })), shippingAddress: 'Damascus, Mazzeh, Street 12, Building 4' },
        }),
        'Order',
      );
      for (const status of plan.to) {
        must(await api('PATCH', `/orders/${order.id}/status`, { token: admin, body: { status } }), `Status ${status}`);
      }
      created++;
    }
  }
  console.log(created ? `✔ Orders: ${created} created` : '✔ Orders: already present');

  console.log('\nDemo accounts');
  console.log(`  Admin     ${ADMIN.email} / ${ADMIN.password}`);
  for (const c of CUSTOMERS) console.log(`  Customer  ${c.email} / ${PASSWORD}`);
}

main().catch((err) => {
  console.error(`✖ ${err.message}`);
  process.exit(1);
});
