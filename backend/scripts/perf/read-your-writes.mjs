// Requirement 3 proof: the read replica lags, yet users see what they just did.
//
// Make the lag visible first (the replica then replays the primary 3 s late):
//   PowerShell:  $env:REPLICA_DELAY_MS=3000; docker compose up -d postgres-replica
//   then:        npm run perf:ryw
//   back:        Remove-Item Env:REPLICA_DELAY_MS; docker compose up -d postgres-replica
import { execFileSync } from 'node:child_process';

const API = process.env.API_URL ?? 'http://localhost:3000/api/v1';

async function api(method, path, { token, body } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { ...(token && { Authorization: `Bearer ${token}` }), ...(body && { 'Content-Type': 'application/json' }) },
    body: body && JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : undefined };
}
const login = async (email, password) => (await api('POST', '/auth/login', { body: { email, password } })).body.accessToken;
const sql = (host, db, query) =>
  execFileSync('docker', ['compose', 'exec', '-T', host, 'psql', '-U', 'app', '-d', db, '-Atc', query], { encoding: 'utf8' }).trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ok = (cond, text) => console.log(`  ${cond ? '✔' : '✖'} ${text}`);

const delayMs = Number(sql('postgres-replica', 'postgres', "SELECT setting FROM pg_settings WHERE name = 'recovery_min_apply_delay'"));
console.log(`Replica apply delay: ${delayMs} ms\n`);

const ahmad = await login('ahmad@shop.local', 'Customer@123');
const admin = await login('admin@shop.local', 'Admin@12345');
const product = (await api('GET', '/products?search=Desk%20Lamp')).body.data[0];

console.log('1. Ahmad places an order, and reads it back at once');
const order = (await api('POST', '/orders', { token: ahmad, body: { items: [{ productId: product.id, quantity: 1 }], shippingAddress: 'Read-your-writes demo, Damascus' } })).body;
const [onReplica, onPrimary, mine, list, adminList] = await Promise.all([
  Promise.resolve(sql('postgres-replica', 'orders_db', `SELECT count(*) FROM orders WHERE id = '${order.id}'`)),
  Promise.resolve(sql('postgres', 'orders_db', `SELECT count(*) FROM orders WHERE id = '${order.id}'`)),
  api('GET', `/orders/${order.id}`, { token: ahmad }),
  api('GET', '/orders?limit=1', { token: ahmad }),
  api('GET', '/orders?status=PENDING&limit=1', { token: admin }),
]);
ok(onPrimary === '1', `primary has the order: ${onPrimary === '1'}`);
console.log(`  · replica has the order yet: ${onReplica === '1'}${onReplica === '1' ? '' : '   ← the lag is real'}`);
ok(mine.status === 200, `Ahmad opens it right away → ${mine.status}`);
ok(list.body.data[0]?.id === order.id, `Ahmad's "my orders" shows it first`);
console.log(`  · admin (who wrote nothing) reads the replica: newest PENDING is the new order? ${adminList.body.data[0]?.id === order.id}`);

console.log('\n2. Admin changes a price; a customer sees it at once (despite Redis and the replica)');
const before = product.price;
await api('PATCH', `/products/${product.id}`, { token: admin, body: { price: before + 1 } });
const seen = (await api('GET', `/products/${product.id}`)).body.price;
ok(seen === before + 1, `price was ${before}, admin set ${before + 1}, customer sees ${seen}`);

console.log('\n3. After the delay the replica has caught up');
await sleep(delayMs + 1000);
ok(sql('postgres-replica', 'orders_db', `SELECT count(*) FROM orders WHERE id = '${order.id}'`) === '1', 'replica now has the order');
const lag = sql('postgres', 'postgres', "SELECT coalesce(replay_lag::text, '0') FROM pg_stat_replication LIMIT 1");
console.log(`  · pg_stat_replication replay_lag: ${lag}`);

// cleanup
await api('PATCH', `/products/${product.id}`, { token: admin, body: { price: before } });
await api('PATCH', `/orders/${order.id}/status`, { token: admin, body: { status: 'CANCELLED' } });
console.log('\n(cleanup: price restored, demo order cancelled)');
