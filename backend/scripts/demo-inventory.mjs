// Requirement 2 demo: the inventory service (Go, gRPC) under pressure.
//
//   npm run demo:race    10 customers order the LAST unit at the same moment → exactly 1 wins
//   npm run demo:order   one order, timed: run it while inventory is stopped or slow
//
// Inventory down:  docker compose stop inventory-service    → 503 in a few ms
// Inventory slow:  set INVENTORY_LATENCY_MS=3000, then docker compose up -d inventory-service → 504 after 2 s
// Back to normal:  docker compose up -d inventory-service   (with INVENTORY_LATENCY_MS unset)
//
// The script cleans up after itself: orders it creates are cancelled and stock is restored.

const API = process.env.API_URL ?? 'http://localhost:3000/api/v1';
const PRODUCT = process.env.DEMO_PRODUCT ?? 'Desk Lamp';
const ADMIN = { email: 'admin@shop.local', password: 'Admin@12345' };
const CUSTOMERS = ['ahmad@shop.local', 'sara@shop.local'].map((email) => ({ email, password: 'Customer@123' }));

async function api(method, path, { token, body } = {}) {
  const started = performance.now();
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { ...(token && { Authorization: `Bearer ${token}` }), ...(body && { 'Content-Type': 'application/json' }) },
    body: body && JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : undefined, ms: Math.round(performance.now() - started) };
}

async function login({ email, password }) {
  const res = await api('POST', '/auth/login', { body: { email, password } });
  if (res.status !== 200) throw new Error(`Login ${email} failed (${res.status}): ${res.body?.message}`);
  return res.body.accessToken;
}

async function findProduct(admin) {
  const res = await api('GET', `/products?search=${encodeURIComponent(PRODUCT)}`, { token: admin });
  const product = res.body?.data?.find((p) => p.name === PRODUCT);
  if (!product) throw new Error(`Product "${PRODUCT}" not found. Run npm run seed first.`);
  return product;
}

const line = (r) => `${String(r.status).padEnd(4)} ${String(r.ms).padStart(5)} ms  ${r.status < 300 ? 'order placed' : r.body?.message}`;

async function race() {
  const admin = await login(ADMIN);
  const tokens = await Promise.all(CUSTOMERS.map(login));
  const product = await findProduct(admin);
  const original = product.stock;

  await api('PATCH', `/products/${product.id}/stock`, { token: admin, body: { stock: 1 } });
  console.log(`"${PRODUCT}": stock set to 1. Sending 10 orders at the same moment...\n`);

  const results = await Promise.all(
    Array.from({ length: 10 }, (_, i) =>
      api('POST', '/orders', {
        token: tokens[i % tokens.length],
        body: { items: [{ productId: product.id, quantity: 1 }], shippingAddress: 'Race condition demo, Damascus' },
      }),
    ),
  );
  results.forEach((r, i) => console.log(`  #${String(i + 1).padStart(2)}  ${line(r)}`));

  const won = results.filter((r) => r.status === 201);
  const after = await api('GET', `/products/${product.id}`);
  console.log(`\n✔ ${won.length} succeeded, ${results.filter((r) => r.status === 409).length} rejected with 409. Stock now: ${after.body.stock}`);

  for (const r of won) await api('PATCH', `/orders/${r.body.id}/status`, { token: admin, body: { status: 'CANCELLED' } });
  await api('PATCH', `/products/${product.id}/stock`, { token: admin, body: { stock: original } });
  console.log(`  (cleanup: demo order cancelled, stock back to ${original})`);
}

async function order() {
  const admin = await login(ADMIN);
  const token = await login(CUSTOMERS[0]);
  const product = await findProduct(admin);
  console.log(`Placing one order for "${PRODUCT}" (stock shown: ${product.stock}, inventory reachable: ${product.inventoryAvailable})...\n`);

  const r = await api('POST', '/orders', {
    token,
    body: { items: [{ productId: product.id, quantity: 1 }], shippingAddress: 'Inventory failure demo, Damascus' },
  });
  console.log(`  ${line(r)}`);
  if (r.status >= 300) console.log(`\n  Full response:\n${JSON.stringify(r.body, null, 2).replace(/^/gm, '  ')}`);
  if (r.status === 201) {
    await api('PATCH', `/orders/${r.body.id}/status`, { token: admin, body: { status: 'CANCELLED' } });
    console.log('  (cleanup: demo order cancelled, stock returned)');
  }
}

const mode = process.argv[2];
const run = { race, order }[mode];
if (!run) {
  console.log('Usage: node scripts/demo-inventory.mjs race|order');
  process.exit(1);
}
run().catch((err) => {
  console.error(`✖ ${err.message}`);
  process.exit(1);
});
