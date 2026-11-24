/**
 * End-to-end tests against the running stack (docker compose up).
 *   npm run test:e2e
 * Proves the security requirements: users can't reach other users' data, and
 * operations outside a role's permissions are rejected.
 * Note: auth routes are rate-limited per IP (20/min), so wait ~1 minute between runs.
 */
import { io, Socket } from 'socket.io-client';

const API = process.env.API_URL ?? 'http://localhost:3000/api/v1';
const WS = process.env.WS_URL ?? new URL(API).origin;
const ADMIN = { email: process.env.ADMIN_EMAIL ?? 'admin@shop.local', password: process.env.ADMIN_PASSWORD ?? 'Admin@12345' };
const PASSWORD = 'Customer@123';
const run = Date.now();

// 1×1 PNG
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

interface Res<T = any> {
  status: number;
  body: T;
}

async function api<T = any>(method: string, path: string, opts: { token?: string; body?: unknown; form?: FormData } = {}): Promise<Res<T>> {
  const headers: Record<string, string> = {};
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: opts.form ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : undefined };
}

const register = (tag: string) =>
  api('POST', '/auth/register', { body: { email: `${tag}.${run}@test.local`, password: PASSWORD, name: `User ${tag}` } });

const imageForm = (buf: Buffer, name: string, type: string) => {
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(buf)], { type }), name);
  return form;
};

/** Every error response uses the same shape. */
function expectErrorShape(res: Res, status: number) {
  expect(res.status).toBe(status);
  expect(res.body).toEqual(
    expect.objectContaining({
      success: false,
      statusCode: status,
      error: expect.any(String),
      message: expect.anything(),
      path: expect.any(String),
      method: expect.any(String),
      timestamp: expect.any(String),
    }),
  );
}

describe('E-commerce API (e2e)', () => {
  let adminToken: string;
  let alice: { token: string; refresh: string; id: string };
  let bob: { token: string; id: string };
  let categoryId: string;
  let productId: string;
  let aliceOrderId: string;
  let socket: Socket;

  afterAll(async () => {
    socket?.disconnect();
    // Hide test data so it doesn't clutter the demo catalogue.
    if (adminToken && productId) await api('DELETE', `/products/${productId}`, { token: adminToken });
    if (adminToken && categoryId) await api('DELETE', `/categories/${categoryId}`, { token: adminToken });
  });

  describe('Infrastructure', () => {
    it('all services are up', async () => {
      const res = await api('GET', '/health');
      expect(res.status).toBe(200);
      expect(Object.values(res.body.services).every((s: any) => s.status === 'up')).toBe(true);
    });
  });

  describe('Authentication', () => {
    it('registers customers and returns tokens', async () => {
      const a = await register('alice');
      const b = await register('bob');
      expect(a.status).toBe(201);
      expect(a.body.user.role).toBe('CUSTOMER');
      expect(a.body.user.passwordHash).toBeUndefined();
      alice = { token: a.body.accessToken, refresh: a.body.refreshToken, id: a.body.user.id };
      bob = { token: b.body.accessToken, id: b.body.user.id };
    });

    it('rejects self-registration as ADMIN (privilege escalation)', async () => {
      const res = await api('POST', '/auth/register', {
        body: { email: `evil.${run}@test.local`, password: PASSWORD, name: 'Evil', role: 'ADMIN' },
      });
      expectErrorShape(res, 400);
    });

    it('rejects weak passwords with a validation error', async () => {
      const res = await api('POST', '/auth/register', { body: { email: `weak.${run}@test.local`, password: '123', name: 'Weak' } });
      expectErrorShape(res, 400);
      expect(res.body.message).toEqual(expect.arrayContaining([expect.stringContaining('password')]));
    });

    it('rejects duplicate emails', async () => {
      expectErrorShape(await register('alice'), 409);
    });

    it('logs in the seeded admin', async () => {
      const res = await api('POST', '/auth/login', { body: ADMIN });
      expect(res.status).toBe(200);
      expect(res.body.user.role).toBe('ADMIN');
      adminToken = res.body.accessToken;
    });

    it('rotates refresh tokens and rejects a reused one', async () => {
      const first = await api('POST', '/auth/refresh', { body: { refreshToken: alice.refresh } });
      expect(first.status).toBe(200);
      const reuse = await api('POST', '/auth/refresh', { body: { refreshToken: alice.refresh } });
      expectErrorShape(reuse, 401);
    });

    it('rejects requests without a token, or with a forged one', async () => {
      expectErrorShape(await api('GET', '/orders'), 401);
      expectErrorShape(await api('GET', '/users/me', { token: 'not.a.jwt' }), 401);
    });
  });

  describe('Role-based access', () => {
    it('customer cannot create products', async () => {
      const res = await api('POST', '/products', { token: alice.token, body: { name: 'Hack', price: 1, stock: 1 } });
      expectErrorShape(res, 403);
    });

    it('customer cannot list users', async () => {
      expectErrorShape(await api('GET', '/users', { token: alice.token }), 403);
    });

    it('customer cannot read dashboard statistics or system info', async () => {
      expectErrorShape(await api('GET', '/orders/stats', { token: alice.token }), 403);
      expectErrorShape(await api('GET', '/system/info', { token: alice.token }), 403);
    });

    it('admin reads dashboard statistics and system info', async () => {
      const stats = await api('GET', '/orders/stats', { token: adminToken });
      expect(stats.status).toBe(200);
      expect(stats.body.byStatus).toEqual(expect.objectContaining({ PENDING: expect.any(Number) }));
      const info = await api('GET', '/system/info', { token: adminToken });
      expect(info.status).toBe(200);
      expect(Object.keys(info.body.services)).toEqual(['users', 'products', 'orders', 'notifications', 'inventory']);
    });

    it('admin manages categories and products', async () => {
      const cat = await api('POST', '/categories', { token: adminToken, body: { name: `Electronics ${run}` } });
      expect(cat.status).toBe(201);
      categoryId = cat.body.id;

      const prod = await api('POST', '/products', {
        token: adminToken,
        body: { name: `Headphones ${run}`, description: 'Wireless', price: 49.99, stock: 3, categoryId },
      });
      expect(prod.status).toBe(201);
      expect(prod.body.price).toBe(49.99);
      productId = prod.body.id;
    });
  });

  describe('Product images', () => {
    it('admin uploads an image, which is publicly served', async () => {
      const res = await api('POST', `/products/${productId}/images`, { token: adminToken, form: imageForm(PNG, 'p.png', 'image/png') });
      expect(res.status).toBe(201);
      expect(res.body.images).toHaveLength(1);
      expect((await fetch(res.body.images[0].url)).status).toBe(200);
    });

    it('rejects a non-image disguised as PNG (magic-byte check)', async () => {
      const fake = imageForm(Buffer.from('MZ this is not an image'), 'evil.png', 'image/png');
      expectErrorShape(await api('POST', `/products/${productId}/images`, { token: adminToken, form: fake }), 400);
    });

    it('customer cannot upload images', async () => {
      const res = await api('POST', `/products/${productId}/images`, { token: alice.token, form: imageForm(PNG, 'p.png', 'image/png') });
      expectErrorShape(res, 403);
    });
  });

  describe('Catalogue', () => {
    it('anyone can browse with filters and pagination', async () => {
      const res = await api('GET', `/products?categoryId=${categoryId}&minPrice=10&sort=price_asc&page=1&limit=5`);
      expect(res.status).toBe(200);
      expect(res.body.data.map((p: any) => p.id)).toContain(productId);
      expect(res.body.meta).toEqual(expect.objectContaining({ page: 1, limit: 5 }));
    });

    it('invalid ids give a clean 400', async () => {
      expectErrorShape(await api('GET', '/products/not-a-uuid'), 400);
    });
  });

  describe('Orders & ownership', () => {
    beforeAll((done) => {
      socket = io(WS, { auth: { token: alice.token }, transports: ['websocket'] });
      socket.on('connect', () => done());
    });

    it('customer places an order; price is computed server-side and stock is reserved', async () => {
      const res = await api('POST', '/orders', {
        token: alice.token,
        body: { items: [{ productId, quantity: 2 }], shippingAddress: 'Damascus, Mazzeh, Street 12' },
      });
      expect(res.status).toBe(201);
      expect(res.body.total).toBeCloseTo(99.98);
      expect(res.body.status).toBe('PENDING');
      aliceOrderId = res.body.id;

      const product = await api('GET', `/products/${productId}`);
      expect(product.body.stock).toBe(1);
    });

    it('cannot oversell: ordering more than the remaining stock fails', async () => {
      const res = await api('POST', '/orders', {
        token: bob.token,
        body: { items: [{ productId, quantity: 2 }], shippingAddress: 'Aleppo, Street 3' },
      });
      expectErrorShape(res, 409);
    });

    it("customer CANNOT read another customer's order", async () => {
      const res = await api('GET', `/orders/${aliceOrderId}`, { token: bob.token });
      expectErrorShape(res, 403);
    });

    it("customer CANNOT cancel another customer's order", async () => {
      expectErrorShape(await api('POST', `/orders/${aliceOrderId}/cancel`, { token: bob.token }), 403);
    });

    it("listing only returns the caller's own orders", async () => {
      const res = await api('GET', '/orders', { token: bob.token });
      expect(res.status).toBe(200);
      expect(res.body.data.every((o: any) => o.userId === bob.id)).toBe(true);
    });

    it('owner and admin can read the order', async () => {
      expect((await api('GET', `/orders/${aliceOrderId}`, { token: alice.token })).status).toBe(200);
      expect((await api('GET', `/orders/${aliceOrderId}`, { token: adminToken })).status).toBe(200);
    });

    it('customer CANNOT change order status (admin only)', async () => {
      const res = await api('PATCH', `/orders/${aliceOrderId}/status`, { token: alice.token, body: { status: 'DELIVERED' } });
      expectErrorShape(res, 403);
    });

    it('admin changes status and the customer is notified in real time', async () => {
      const received = new Promise<any>((resolve) =>
        socket.on('notification', (n) => n.type === 'order.status_changed' && resolve(n)),
      );
      const res = await api('PATCH', `/orders/${aliceOrderId}/status`, { token: adminToken, body: { status: 'CONFIRMED' } });
      expect(res.status).toBe(200);
      expect(res.body.history.map((h: any) => h.status)).toEqual(['PENDING', 'CONFIRMED']);

      const notification = await received;
      expect(notification.data).toEqual(expect.objectContaining({ orderId: aliceOrderId, to: 'CONFIRMED' }));
    });

    it('invalid status transitions are rejected', async () => {
      const res = await api('PATCH', `/orders/${aliceOrderId}/status`, { token: adminToken, body: { status: 'DELIVERED' } });
      expectErrorShape(res, 400);
    });

    it('customer cannot cancel once the order is confirmed', async () => {
      expectErrorShape(await api('POST', `/orders/${aliceOrderId}/cancel`, { token: alice.token }), 400);
    });

    it('admin cancellation returns the stock', async () => {
      const res = await api('PATCH', `/orders/${aliceOrderId}/status`, { token: adminToken, body: { status: 'CANCELLED' } });
      expect(res.status).toBe(200);
      expect((await api('GET', `/products/${productId}`)).body.stock).toBe(3);
    });

    it('under concurrent load, exactly the available stock is sold (no overselling)', async () => {
      const attempts = await Promise.all(
        Array.from({ length: 10 }, (_, i) =>
          api('POST', '/orders', {
            token: i % 2 ? alice.token : bob.token,
            body: { items: [{ productId, quantity: 1 }], shippingAddress: 'Concurrent street 1' },
          }),
        ),
      );
      expect(attempts.filter((r) => r.status === 201)).toHaveLength(3);
      expect(attempts.filter((r) => r.status === 409)).toHaveLength(7);
      expect((await api('GET', `/products/${productId}`)).body.stock).toBe(0);
    });
  });

  describe('Inventory service (Go, gRPC)', () => {
    it('product details show the stock reported by inventory-service', async () => {
      const res = await api('GET', `/products/${productId}`);
      expect(res.status).toBe(200);
      expect(res.body).toEqual(expect.objectContaining({ stock: 0, inventoryAvailable: true }));
    });

    it('race for the last unit: exactly one order wins, the rest get a clear 409', async () => {
      expect((await api('PATCH', `/products/${productId}/stock`, { token: adminToken, body: { stock: 1 } })).body.stock).toBe(1);
      const attempts = await Promise.all(
        Array.from({ length: 10 }, (_, i) =>
          api('POST', '/orders', {
            token: i % 2 ? alice.token : bob.token,
            body: { items: [{ productId, quantity: 1 }], shippingAddress: 'Last unit street 1' },
          }),
        ),
      );
      expect(attempts.filter((r) => r.status === 201)).toHaveLength(1);
      const rejected = attempts.filter((r) => r.status === 409);
      expect(rejected).toHaveLength(9);
      for (const r of rejected) {
        expectErrorShape(r, 409);
        expect(r.body.message).toMatch(/Insufficient stock for "Headphones/);
      }
      expect((await api('GET', `/products/${productId}`)).body.stock).toBe(0);
    });

    it('an order is all or nothing: one missing item reserves nothing', async () => {
      await api('PATCH', `/products/${productId}/stock`, { token: adminToken, body: { stock: 5 } });
      const other = await api('POST', '/products', { token: adminToken, body: { name: `Empty ${run}`, price: 1, stock: 0 } });
      const res = await api('POST', '/orders', {
        token: alice.token,
        body: { items: [{ productId, quantity: 2 }, { productId: other.body.id, quantity: 1 }], shippingAddress: 'All or nothing 1' },
      });
      expectErrorShape(res, 409);
      expect((await api('GET', `/products/${productId}`)).body.stock).toBe(5);
    });
  });

  describe('Requirement 4: queues and real-time channels', () => {
    const MAILPIT = process.env.MAILPIT_URL ?? 'http://localhost:8025';
    const sockets: Socket[] = [];
    const connect = (token: string) =>
      new Promise<Socket>((resolve) => {
        const s = io(WS, { auth: { token }, transports: ['websocket'], reconnection: false });
        sockets.push(s);
        s.on('connect', () => resolve(s));
      });
    const subscribe = (s: Socket, payload: object) => new Promise<any>((resolve) => s.emit('subscribe', payload, resolve));
    let r4OrderId: string;
    let adminSocket: Socket;
    let aliceSocket: Socket;
    let bobSocket: Socket;

    beforeAll(async () => {
      [adminSocket, aliceSocket, bobSocket] = await Promise.all([connect(adminToken), connect(alice.token), connect(bob.token)]);
    });
    afterAll(() => sockets.forEach((s) => s.disconnect()));

    it('only admins can subscribe to the admin channel', async () => {
      expect(await subscribe(adminSocket, { channel: 'admin.orders' })).toEqual({ ok: true, channel: 'admin.orders' });
      expect(await subscribe(aliceSocket, { channel: 'admin.orders' })).toEqual(expect.objectContaining({ ok: false, status: 403 }));
    });

    it('a new order reaches the admin channel instantly, and the API answers without waiting for the email', async () => {
      const pushed = new Promise<any>((resolve) => adminSocket.on('order.created', resolve));
      const started = Date.now();
      const res = await api('POST', '/orders', {
        token: alice.token,
        body: { items: [{ productId, quantity: 1 }], shippingAddress: 'Realtime street 4' },
      });
      expect(res.status).toBe(201);
      r4OrderId = res.body.id;
      const event = await pushed;
      expect(event).toEqual(expect.objectContaining({ orderId: r4OrderId, userId: alice.id, status: 'PENDING' }));
      expect(Date.now() - started).toBeLessThan(3000);
    });

    it('only the owner can follow an order channel', async () => {
      expect(await subscribe(aliceSocket, { channel: 'order', orderId: r4OrderId })).toEqual({ ok: true, channel: `order:${r4OrderId}` });
      expect(await subscribe(bobSocket, { channel: 'order', orderId: r4OrderId })).toEqual(expect.objectContaining({ ok: false, status: 403 }));
      expect(await subscribe(bobSocket, { channel: 'order', orderId: 'not-a-uuid' })).toEqual(expect.objectContaining({ ok: false, status: 400 }));
      expect(await subscribe(bobSocket, { channel: 'nope' })).toEqual(expect.objectContaining({ ok: false, status: 400 }));
    });

    it('a status change reaches the owner live, and nobody else', async () => {
      let bobGot = false;
      bobSocket.on('order.status', () => (bobGot = true));
      const pushed = new Promise<any>((resolve) => aliceSocket.on('order.status', (e) => e.orderId === r4OrderId && resolve(e)));
      expect((await api('PATCH', `/orders/${r4OrderId}/status`, { token: adminToken, body: { status: 'CONFIRMED' } })).status).toBe(200);
      expect(await pushed).toEqual(expect.objectContaining({ orderId: r4OrderId, from: 'PENDING', to: 'CONFIRMED' }));
      await new Promise((r) => setTimeout(r, 500));
      expect(bobGot).toBe(false);
    });

    it('the email worker sends the confirmation email (local inbox: Mailpit)', async () => {
      const ref = `#${r4OrderId.slice(0, 8)}`;
      let mail: any;
      for (let i = 0; i < 40 && !mail; i++) {
        const list = await fetch(`${MAILPIT}/api/v1/messages?limit=200`).then((r) => r.json());
        mail = list.messages?.find((m: any) => m.Subject?.includes(ref));
        if (!mail) await new Promise((r) => setTimeout(r, 500));
      }
      expect(mail).toBeDefined();
      expect(mail.To[0].Address).toBe(`alice.${run}@test.local`);
    }, 30000);

    it('consumer queues are durable and each has three replicas', async () => {
      const info = await api('GET', '/system/info', { token: adminToken });
      const byName = Object.fromEntries(info.body.queues.map((q: any) => [q.name, q]));
      expect(byName['email.order-created']).toEqual(expect.objectContaining({ durable: true, consumers: 3 }));
      expect(byName['notifications.events']).toEqual(expect.objectContaining({ durable: true, consumers: 3 }));
      expect(byName['email.retry']).toBeDefined();
      expect(byName['email.dead']).toBeDefined();
      expect(byName['notifications.dead']).toBeDefined();
    });
  });

  describe('Notifications', () => {
    it("customer sees own notifications but cannot mark another user's as read", async () => {
      const mine = await api('GET', '/notifications', { token: alice.token });
      expect(mine.status).toBe(200);
      expect(mine.body.data.length).toBeGreaterThan(0);
      expect(mine.body.data.every((n: any) => n.userId === alice.id)).toBe(true);

      const res = await api('PATCH', `/notifications/${mine.body.data[0].id}/read`, { token: bob.token });
      expectErrorShape(res, 403);
    });

    it('rejects WebSocket connections without a valid token', (done) => {
      const anon = io(WS, { auth: { token: 'bad' }, transports: ['websocket'], reconnection: false });
      anon.on('disconnect', () => done());
    });
  });

  describe('Brute-force protection', () => {
    it('locks the account after 5 failed logins (423), even for the right password', async () => {
      const email = `carol.${run}@test.local`;
      await api('POST', '/auth/register', { body: { email, password: PASSWORD, name: 'Carol' } });
      for (let i = 0; i < 5; i++) {
        expectErrorShape(await api('POST', '/auth/login', { body: { email, password: 'Wrong@1234' } }), 401);
      }
      expectErrorShape(await api('POST', '/auth/login', { body: { email, password: PASSWORD } }), 423);
    });

    it('rate-limits login attempts per IP (429)', async () => {
      let last: Res | undefined;
      for (let i = 0; i < 40 && last?.status !== 429; i++) {
        last = await api('POST', '/auth/login', { body: { email: `nobody.${run}@test.local`, password: 'Wrong@1234' } });
      }
      expectErrorShape(last!, 429);
    });
  });
});
