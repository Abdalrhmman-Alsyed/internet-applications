// Requirement 2 demo: inventory service in Go, over gRPC.   npm run demo:2
import { ACCOUNTS, after, answer, api, before, bold, compose, confirm, dim, login, ok, run, say, show, step, table, title, waitHealthy, preflight } from './lib.mjs';
import { execFileSync } from 'node:child_process';
import { BACKEND } from './lib.mjs';

const PRODUCT = 'Desk Lamp';
let admin;
let product;
let originalStock;
const placed = [];
let inventoryChanged = false;

await run(
  async () => {
    await preflight();
    title('Requirement 2: inter-service communication', 'Stock moved to its own service, written in Go, with its own database, reached over gRPC');

    await step('Before vs after: where stock lives', 'Before: a column of the products table. After: a separate Go service with its own database.');
    const oldSchema = execFileSync('git', ['show', 'c2366e5:backend/apps/products-service/prisma/schema.prisma'], { cwd: BACKEND, encoding: 'utf8' });
    before(`products-service schema (commit c2366e5):  ${oldSchema.split('\n').find((l) => /\bstock\b/.test(l)).trim()}`);
    const nowColumns = compose(['exec', '-T', 'postgres', 'psql', '-U', 'app', '-d', 'products_db', '-Atc', "SELECT string_agg(column_name, ', ') FROM information_schema.columns WHERE table_name = 'products'"]);
    after(`products table columns now:  ${nowColumns}   ${dim('(no stock)')}`);
    after(`inventory_db.stock rows:  ${compose(['exec', '-T', 'postgres', 'psql', '-U', 'app', '-d', 'inventory_db', '-Atc', 'SELECT count(*) FROM stock'])}`);
    show('container', compose(['ps', 'inventory-service', '--format', '{{.Name}}  {{.Status}}']));
    show('contract', 'proto/inventory.proto → CheckStock · ReserveStock · ReleaseStock (+ SetStock, ListStock for admins)');
    show('key line', 'inventory-service/store.go:183  UPDATE stock … WHERE quantity >= $2');

    await step('Product details: the quantity comes from inventory-service over gRPC', 'products-service calls CheckStock once per page (not once per product).');
    admin = await login(...ACCOUNTS.admin);
    product = (await api('GET', `/products?search=${encodeURIComponent(PRODUCT)}`)).body.data.find((p) => p.name === PRODUCT);
    originalStock = product.stock;
    const detail = await api('GET', `/products/${product.id}`);
    say(`GET /products/${product.id.slice(0, 8)}…  →  ${answer(detail)}`);
    show(detail.body.name, `stock ${detail.body.stock}   inventoryAvailable ${detail.body.inventoryAvailable}`);
    const logLine = compose(['logs', '--tail', '20', 'inventory-service']).split('\n').reverse().find((l) => l.includes('CheckStock'));
    show('inventory log', dim(logLine?.replace(/^.*?msg=/, 'msg=') ?? '(none)'));

    await step(`10 customers order the LAST "${PRODUCT}" at the same moment`, 'The reserve is one atomic UPDATE: Postgres locks the row, the second request re-checks and fails.');
    const ahmad = await login(...ACCOUNTS.ahmad);
    const sara = await login(...ACCOUNTS.sara);
    await api('PATCH', `/products/${product.id}/stock`, { token: admin.token, body: { stock: 1 } });
    say(`stock set to 1, sending 10 orders in parallel...\n`);
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        api('POST', '/orders', {
          token: [ahmad, sara][i % 2].token,
          body: { items: [{ productId: product.id, quantity: 1 }], shippingAddress: 'Race condition demo, Damascus' },
        }),
      ),
    );
    results.forEach((r, i) => say(`#${String(i + 1).padStart(2)}  ${answer(r)}`));
    results.filter((r) => r.status === 201).forEach((r) => placed.push(r.body.id));
    const left = (await api('GET', `/products/${product.id}`)).body.stock;
    ok(placed.length === 1, `${placed.length} succeeded, ${results.filter((r) => r.status === 409).length} got 409. Stock now: ${left}`);

    await step('All or nothing: one item without stock reserves NOTHING', 'Every item is reserved in one transaction; if one fails, the whole order rolls back.');
    await api('PATCH', `/products/${product.id}/stock`, { token: admin.token, body: { stock: 5 } });
    const empty = (await api('GET', '/products?maxStock=0&limit=1')).body.data[0]; // public list: active products only
    const mixed = await api('POST', '/orders', {
      token: ahmad.token,
      body: { items: [{ productId: product.id, quantity: 2 }, { productId: empty.id, quantity: 1 }], shippingAddress: 'All or nothing demo' },
    });
    say(`order: 2 × "${PRODUCT}" (5 in stock) + 1 × "${empty.name}" (0 in stock)  →  ${answer(mixed)}`);
    ok((await api('GET', `/products/${product.id}`)).body.stock === 5, `"${PRODUCT}" still has 5: nothing was reserved`);

    await step('inventory-service is STOPPED → clear answer within 2 seconds', 'Every gRPC call has a deadline, so nobody waits forever.');
    inventoryChanged = true;
    compose(['stop', 'inventory-service']);
    say('docker compose stop inventory-service');
    const down = await api('POST', '/orders', {
      token: ahmad.token,
      body: { items: [{ productId: product.id, quantity: 1 }], shippingAddress: 'Inventory down demo' },
    });
    say(`place an order  →  ${answer(down)}   ${bold(`${down.ms} ms`)}`);
    const browse = await api('GET', `/products/${product.id}`);
    say(`browse the product  →  ${answer(browse)}   stock ${browse.body.stock}, inventoryAvailable ${browse.body.inventoryAvailable}  ${dim('(shop still works)')}`);
    say(dim('restarting inventory-service...'));
    compose(['up', '-d', 'inventory-service']);
    await waitHealthy('inventory-service');

    if (await confirm('Also show a SLOW inventory (answers after 3 s, our deadline is 2 s)?')) {
      await step('inventory-service is SLOW (3 s per call) → 504 after exactly 2 s', 'The deadline also reaches Go: it stops working when the caller gives up (deadline propagation).');
      compose(['up', '-d', 'inventory-service'], { INVENTORY_LATENCY_MS: '3000' });
      await waitHealthy('inventory-service');
      const slow = await api('POST', '/orders', {
        token: ahmad.token,
        body: { items: [{ productId: product.id, quantity: 1 }], shippingAddress: 'Inventory slow demo' },
      });
      say(`place an order  →  ${answer(slow)}   ${bold(`${slow.ms} ms`)}`);
      const gaveUp = compose(['logs', '--tail', '10', 'inventory-service']).split('\n').find((l) => l.includes('caller gave up') && l.includes('ReserveStock'));
      show('inventory log', dim(gaveUp?.replace(/^.*?msg=/, 'msg=') ?? '(none)'));
      say(dim('back to normal speed...'));
      compose(['up', '-d', 'inventory-service'], { INVENTORY_LATENCY_MS: '0' });
      await waitHealthy('inventory-service');
    }
    inventoryChanged = false;

    await step('Summary', '');
    table([
      ['', 'Before', 'After'],
      ['Stock lives in', 'products.stock column', 'inventory-service (Go) + inventory_db'],
      ['Talks over', 'NestJS TCP', 'gRPC, contract in proto/inventory.proto'],
      ['Inventory down', 'no special handling', '503 within 2 s, shop still browsable'],
      ['Inventory slow', 'waits', '504 after the 2 s deadline'],
      ['Last unit, 10 buyers', 'protected', '1 wins, 9 get 409 with the product name'],
    ]);
  },
  async () => {
    if (inventoryChanged) {
      compose(['up', '-d', 'inventory-service'], { INVENTORY_LATENCY_MS: '0' });
      await waitHealthy('inventory-service');
    }
    if (admin) {
      for (const id of placed) await api('PATCH', `/orders/${id}/status`, { token: admin.token, body: { status: 'CANCELLED' } });
      if (product && originalStock !== undefined) await api('PATCH', `/products/${product.id}/stock`, { token: admin.token, body: { stock: originalStock } });
      console.log(dim(`\n  (cleanup: demo orders cancelled, "${PRODUCT}" stock back to ${originalStock}, inventory at normal speed)`));
    }
  },
);
