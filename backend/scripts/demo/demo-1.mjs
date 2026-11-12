// Requirement 1 demo: API design and security.   npm run demo:1
import { io } from 'socket.io-client';
import { ACCOUNTS, answer, api, bold, compose, confirm, dim, login, ok, run, say, show, sleep, step, table, title, preflight } from './lib.mjs';

const WS = process.env.WS_URL ?? 'http://localhost:3004';
let demoOrder;
let admin;
let socket;

await run(
  async () => {
    await preflight();
    title('Requirement 1: API design & security', 'NestJS microservices behind one API gateway · JWT · roles · ownership · validation');

    await step('The system is up', 'One gateway in front of the services; /health asks each one over TCP / gRPC.');
    const health = await api('GET', '/health');
    for (const [name, s] of Object.entries(health.body.services)) show(name, `${s.status === 'up' ? '✔ up' : '✖ down'}  ${s.latencyMs ?? '-'} ms`);
    show('containers', compose(['ps', '--format', '{{.Name}}']).split('\n').length);

    await step('Anyone can browse products (public route, with filters and pagination)', 'GET /products is marked @Public(); every other route needs a token.');
    const cats = await api('GET', '/categories');
    const electronics = cats.body.find((c) => c.name === 'Electronics');
    const page = await api('GET', `/products?categoryId=${electronics.id}&sort=price_asc&limit=3`);
    say(`GET /products?categoryId=Electronics&sort=price_asc&limit=3  →  ${answer(page)}`);
    for (const p of page.body.data) show(p.name, `$${p.price}   stock ${p.stock}`);
    show('meta', JSON.stringify(page.body.meta));

    await step('No token → 401, in one uniform error format', 'Every error in the whole API has this exact shape.');
    const noToken = await api('GET', '/orders');
    say(`GET /orders without a token  →  ${answer(noToken)}`);
    console.log(dim(JSON.stringify(noToken.body, null, 2).replace(/^/gm, '    ')));

    await step('A forged token that claims ADMIN → 401', 'The signature is checked with the server secret, so editing the token is useless.');
    const forged = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJoYWNrZXIiLCJyb2xlIjoiQURNSU4ifQ.forged-signature';
    say(`GET /users/me with a forged token  →  ${answer(await api('GET', '/users/me', { token: forged }))}`);

    await step('Register yourself as ADMIN → 400', 'Unknown fields are rejected (whitelist + forbidNonWhitelisted). Sign-ups are always CUSTOMER.');
    const evil = await api('POST', '/auth/register', {
      body: { email: `evil.${Date.now()}@test.local`, password: 'Customer@123', name: 'Evil', role: 'ADMIN' },
    });
    say(`POST /auth/register { …, "role": "ADMIN" }  →  ${answer(evil)}`);

    await step('Ahmad logs in and places an order; the server computes the price', 'The app sends only product ids and quantities. Prices come from the database.');
    const ahmad = await login(...ACCOUNTS.ahmad);
    const sara = await login(...ACCOUNTS.sara);
    admin = await login(...ACCOUNTS.admin);
    const lamp = (await api('GET', '/products?search=Headphones')).body.data[0];
    const order = await api('POST', '/orders', {
      token: ahmad.token,
      body: { items: [{ productId: lamp.id, quantity: 1 }], shippingAddress: 'Requirement 1 demo, Damascus' },
    });
    say(`POST /orders  →  ${answer(order)}`);
    if (order.status !== 201) {
      throw new Error('The order could not be placed, so the next steps would not make sense. Check that every service is up (docker compose ps) and run demo-1 again.');
    }
    demoOrder = order.body;
    show('order', `#${demoOrder.id.slice(0, 8)}  ${demoOrder.items[0].productName} × 1  total $${demoOrder.total}  status ${demoOrder.status}`);

    // Listen for Ahmad's real-time notifications (Socket.io, authenticated with his token)
    const received = [];
    socket = io(WS, { auth: { token: ahmad.token }, transports: ['websocket'] });
    socket.on('notification', (n) => received.push(n));
    await sleep(800);

    await step("Sara tries to read and cancel Ahmad's order → 403", 'Ownership is checked inside orders-service: order.userId must be the caller.');
    table([
      ['Who', 'Request', 'Result'],
      ['Sara', `GET /orders/${demoOrder.id.slice(0, 8)}…`, answer(await api('GET', `/orders/${demoOrder.id}`, { token: sara.token }))],
      ['Sara', `POST /orders/${demoOrder.id.slice(0, 8)}…/cancel`, answer(await api('POST', `/orders/${demoOrder.id}/cancel`, { token: sara.token }))],
      ['Ahmad (owner)', `GET /orders/${demoOrder.id.slice(0, 8)}…`, answer(await api('GET', `/orders/${demoOrder.id}`, { token: ahmad.token }))],
    ]);

    await step('A customer tries admin actions → 403', '@Roles(ADMIN) on the gateway, and orders-service checks the role again (defense in depth).');
    table([
      ['Ahmad tries to…', 'Result'],
      ['change his order to DELIVERED', answer(await api('PATCH', `/orders/${demoOrder.id}/status`, { token: ahmad.token, body: { status: 'DELIVERED' } }))],
      ['create a product', answer(await api('POST', '/products', { token: ahmad.token, body: { name: 'Hack', price: 1 } }))],
      ['list all users', answer(await api('GET', '/users', { token: ahmad.token }))],
      ['read sales statistics', answer(await api('GET', '/orders/stats', { token: ahmad.token }))],
    ]);

    await step('The admin confirms the order; Ahmad is notified in real time', 'orders-service publishes an event on RabbitMQ; notifications-service pushes it over Socket.io.');
    const confirmed = await api('PATCH', `/orders/${demoOrder.id}/status`, { token: admin.token, body: { status: 'CONFIRMED' } });
    say(`Admin: PATCH /orders/…/status CONFIRMED  →  ${answer(confirmed)}`);
    show('history', confirmed.body.history.map((h) => h.status).join(' → '));
    for (let i = 0; i < 20 && !received.some((n) => n.type === 'order.status_changed'); i++) await sleep(150);
    const pushed = received.find((n) => n.type === 'order.status_changed');
    ok(!!pushed, `Ahmad's socket received: ${pushed ? `"${pushed.title}: ${pushed.body}"` : 'nothing'}`);

    await step('Invalid input and invalid transitions → 400', 'class-validator on every DTO, ParseUUIDPipe on ids, and an allowed-transitions table for statuses.');
    table([
      ['Request', 'Result'],
      ['CONFIRMED → DELIVERED (must ship first)', answer(await api('PATCH', `/orders/${demoOrder.id}/status`, { token: admin.token, body: { status: 'DELIVERED' } }))],
      ['order with quantity -5', answer(await api('POST', '/orders', { token: ahmad.token, body: { items: [{ productId: lamp.id, quantity: -5 }], shippingAddress: 'Somewhere 1' } }))],
      ['GET /orders/1 OR 1=1', answer(await api('GET', '/orders/1%20OR%201=1', { token: admin.token }))],
    ]);

    await step('Brute force: 5 wrong passwords lock the account (423)', 'Even the correct password is refused for 15 minutes. Done on a throw-away account.');
    const email = `lockme.${Date.now()}@test.local`;
    await api('POST', '/auth/register', { body: { email, password: 'Customer@123', name: 'Lock Me' } });
    const tries = [];
    for (let i = 1; i <= 5; i++) tries.push((await api('POST', '/auth/login', { body: { email, password: `Wrong${i}pass` } })).status);
    show('5 wrong passwords', tries.join(', '));
    say(`6th try with the RIGHT password  →  ${answer(await api('POST', '/auth/login', { body: { email, password: 'Customer@123' } }))}`);

    if (await confirm('Show the rate limit (429)? It blocks logins from this PC for about one minute, so do it last')) {
      await step('Rate limit: too many login requests from one IP → 429', 'Max 20 login/register requests per minute per IP, 300 for everything else.');
      let n = 0;
      let r;
      do {
        n += 1;
        r = await api('POST', '/auth/login', { body: { email: 'nobody@test.local', password: 'x' } });
      } while (r.status !== 429 && n < 40);
      say(`request #${n}  →  ${answer(r)}`);
    }

    console.log(`\n${bold('  Done.')} Every rule is enforced by the server, not just hidden in the app.`);
  },
  async () => {
    socket?.disconnect();
    if (demoOrder && admin) await api('PATCH', `/orders/${demoOrder.id}/status`, { token: admin.token, body: { status: 'CANCELLED' } });
  },
);
