// Requirement 3: realistic data volume, so slow queries actually show up.
//
//   npm run perf:data            300,000 orders (+ ~600k items, ~750k status rows) and 20,000 products
//   npm run perf:data -- --clean remove everything this script added
//
// Written straight into Postgres with generate_series (seconds, not hours).
// Everything is tagged so it can be removed: orders have shippingAddress 'LOADTEST …',
// products live in the category "Load test" and are older than the real catalogue,
// so the shop still shows the real products first.
import { execFileSync } from 'node:child_process';

const ORDERS = Number(process.env.PERF_ORDERS ?? 300_000);
const PRODUCTS = Number(process.env.PERF_PRODUCTS ?? 20_000);
const PER_CUSTOMER = Number(process.env.PERF_PER_CUSTOMER ?? 3_000); // Ahmad and Sara each get this many

function psql(db, sql, { quiet = false } = {}) {
  const out = execFileSync('docker', ['compose', 'exec', '-T', 'postgres', 'psql', '-U', 'app', '-d', db, '-v', 'ON_ERROR_STOP=1', '-At'], {
    input: sql,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', quiet ? 'pipe' : 'inherit'],
  });
  return out.trim();
}

function timed(label, fn) {
  const started = Date.now();
  const result = fn();
  console.log(`✔ ${label} (${((Date.now() - started) / 1000).toFixed(1)} s)`);
  return result;
}

function clean() {
  timed('Removed load-test orders', () => psql('orders_db', `DELETE FROM orders WHERE "shippingAddress" LIKE 'LOADTEST%';`));
  const ids = psql('products_db', `SELECT p.id FROM products p JOIN categories c ON c.id = p."categoryId" WHERE c.name = 'Load test';`);
  timed('Removed load-test stock', () =>
    psql('inventory_db', `DELETE FROM stock WHERE product_id IN (SELECT unnest(ARRAY[${ids ? ids.split('\n').map((i) => `'${i}'`).join(',') : ''}]::uuid[]));`),
  );
  timed('Removed load-test products', () =>
    psql('products_db', `DELETE FROM products WHERE "categoryId" IN (SELECT id FROM categories WHERE name = 'Load test'); DELETE FROM categories WHERE name = 'Load test';`),
  );
  for (const db of ['orders_db', 'products_db', 'inventory_db']) psql(db, 'VACUUM ANALYZE;', { quiet: true });
}

function generate() {
  const existing = Number(psql('orders_db', `SELECT count(*) FROM orders WHERE "shippingAddress" LIKE 'LOADTEST%';`));
  if (existing > 0) {
    console.log(`Load-test data already present (${existing} orders). Run with --clean first to regenerate.`);
    return;
  }

  // Real customers and products, so the data looks like the app's own.
  const customers = psql('users_db', `SELECT id FROM users WHERE role = 'CUSTOMER' AND email IN ('ahmad@shop.local','sara@shop.local') ORDER BY email;`).split('\n');
  if (customers.length < 2) throw new Error('Run npm run seed first (needs ahmad@ and sara@).');
  const catalogue = psql('products_db', `SELECT id || '|' || replace(name, '''', '''''') || '|' || price FROM products WHERE "isActive" ORDER BY "createdAt" LIMIT 13;`)
    .split('\n')
    .map((row) => row.split('|'));

  // ── Products (20k, older than the real catalogue) + their stock ──
  timed(`${PRODUCTS.toLocaleString()} products`, () =>
    psql('products_db', `
      INSERT INTO categories (id, name, slug) VALUES (gen_random_uuid(), 'Load test', 'load-test') ON CONFLICT (name) DO NOTHING;
      INSERT INTO products (id, name, description, price, "isActive", "categoryId", "createdAt", "updatedAt")
      SELECT gen_random_uuid(),
             'Sample item ' || lpad(g::text, 5, '0'),
             'Generated for load testing: ' || (ARRAY['cotton','steel','wireless','leather','organic','compact'])[1 + g % 6] || ' edition',
             round((5 + random() * 495)::numeric, 2),
             true,
             (SELECT id FROM categories WHERE name = 'Load test'),
             now() - interval '400 days' + g * interval '1 minute',
             now() - interval '400 days'
      FROM generate_series(1, ${PRODUCTS}) g;`),
  );
  const bulkIds = psql('products_db', `SELECT id FROM products WHERE "categoryId" = (SELECT id FROM categories WHERE name = 'Load test');`).split('\n');
  timed('Their stock in inventory_db', () =>
    psql('inventory_db', `INSERT INTO stock (product_id, quantity)
      SELECT unnest(ARRAY[${bulkIds.map((i) => `'${i}'`).join(',')}]::uuid[]), (random() * 200)::int
      ON CONFLICT (product_id) DO NOTHING;`),
  );

  // ── Orders: spread over the last year, realistic status mix ──
  const productsArray = `ARRAY[${catalogue.map(([id]) => `'${id}'`).join(',')}]::uuid[]`;
  const namesArray = `ARRAY[${catalogue.map(([, name]) => `'${name}'`).join(',')}]`;
  const pricesArray = `ARRAY[${catalogue.map(([, , price]) => price).join(',')}]::numeric[]`;
  const n = catalogue.length;

  timed(`${ORDERS.toLocaleString()} orders with items and status history`, () =>
    psql('orders_db', `
      CREATE TEMP TABLE gen AS
      SELECT g,
             gen_random_uuid() AS id,
             CASE WHEN g <= ${PER_CUSTOMER} THEN '${customers[0]}'
                  WHEN g <= ${PER_CUSTOMER * 2} THEN '${customers[1]}'
                  ELSE gen_random_uuid()::text END AS user_id,
             (ARRAY['DELIVERED','DELIVERED','DELIVERED','DELIVERED','SHIPPED','CONFIRMED','PENDING','CANCELLED'])[1 + (random() * 7)::int]::"OrderStatus" AS status,
             now() - random() * interval '365 days' AS created_at,
             1 + (random() * 2)::int AS lines
      FROM generate_series(1, ${ORDERS}) g;

      CREATE TEMP TABLE gen_items AS
      SELECT gen.id AS order_id, l, (1 + (random() * ${n - 1})::int) AS p, 1 + (random() * 3)::int AS qty
      FROM gen, generate_series(1, gen.lines) l;

      CREATE TEMP TABLE gen_totals AS
      SELECT order_id, sum((${pricesArray})[p] * qty) AS total FROM gen_items GROUP BY order_id;

      INSERT INTO orders (id, "userId", status, total, "shippingAddress", "createdAt", "updatedAt")
      SELECT gen.id, gen.user_id, gen.status, t.total,
             'LOADTEST ' || (ARRAY['Damascus','Aleppo','Homs','Latakia','Hama'])[1 + gen.g % 5] || ', Street ' || (gen.g % 90),
             gen.created_at, gen.created_at
      FROM gen JOIN gen_totals t ON t.order_id = gen.id;

      INSERT INTO order_items (id, "orderId", "productId", "productName", "unitPrice", quantity)
      SELECT gen_random_uuid(), i.order_id, (${productsArray})[i.p], (${namesArray})[i.p], (${pricesArray})[i.p], i.qty
      FROM gen_items i;

      -- History: PENDING, then each step up to the current status
      INSERT INTO order_status_history (id, "orderId", status, "changedBy", "createdAt")
      SELECT gen_random_uuid(), gen.id, s.status::"OrderStatus", gen.user_id, gen.created_at + s.step * interval '1 day'
      FROM gen
      JOIN LATERAL (
        SELECT * FROM (VALUES (0, 'PENDING'), (1, 'CONFIRMED'), (2, 'SHIPPED'), (3, 'DELIVERED')) v(step, status)
        WHERE gen.status <> 'CANCELLED'
          AND v.step <= array_position(ARRAY['PENDING','CONFIRMED','SHIPPED','DELIVERED'], gen.status::text) - 1
        UNION ALL
        SELECT * FROM (VALUES (0, 'PENDING'), (1, 'CANCELLED')) v(step, status) WHERE gen.status = 'CANCELLED'
      ) s ON true;`),
  );

  for (const db of ['orders_db', 'products_db', 'inventory_db']) timed(`VACUUM ANALYZE ${db}`, () => psql(db, 'VACUUM ANALYZE;', { quiet: true }));
  console.log('\n' + psql('orders_db', `SELECT 'orders: ' || (SELECT count(*) FROM orders) || ', items: ' || (SELECT count(*) FROM order_items) || ', history: ' || (SELECT count(*) FROM order_status_history);`));
  console.log(psql('products_db', `SELECT 'products: ' || count(*) FROM products;`));
}

process.argv.includes('--clean') ? clean() : generate();
