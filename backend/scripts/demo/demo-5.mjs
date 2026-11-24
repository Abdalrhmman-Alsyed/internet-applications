import { strict as assert } from 'node:assert';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import * as amqp from 'amqplib';
import { io } from 'socket.io-client';
if (process.argv.includes('--isolated')) {
  process.env.COMPOSE_PROJECT_NAME ??= 'ecommerce-req5';
  process.env.REQ5_COMPOSE_OVERRIDE ??= fileURLToPath(new URL('../../../docker-compose.demo.yml', import.meta.url));
  process.env.API_URL ??= 'http://localhost:13000/api/v1';
  process.env.MAILPIT_URL ??= 'http://localhost:18025';
  process.env.RABBITMQ_URL ??= 'amqp://app:app_password@localhost:25672';
}

const { API, BACKEND, api, login } = await import('./lib.mjs');

const run = promisify(execFile);
const composeFiles = ['-f', resolve(BACKEND, '../docker-compose.yml')];
if (process.env.REQ5_COMPOSE_OVERRIDE) composeFiles.push('-f', resolve(process.env.REQ5_COMPOSE_OVERRIDE));
const compose = async (args) => (await run('docker', ['compose', ...composeFiles, ...args])).stdout.trim();
const docker = async (args) => (await run('docker', args)).stdout.trim();
const WS = process.env.WS_URL ?? new URL(API).origin;
const MAILPIT = process.env.MAILPIT_URL ?? 'http://localhost:8025';
const RABBIT = process.env.RABBITMQ_URL ?? 'amqp://app:app_password@localhost:5672';
const TOTAL = 500;
const EMAIL_QUEUE = 'email.order-created';
const sockets = [];
const stopped = new Set();
const dashboard = process.argv.includes('--dashboard');

function report(type, data = {}) {
  if (dashboard) console.log(`DEMO5 ${JSON.stringify({ type, ...data })}`);
}

async function waitFor(description, check, timeout = 20_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = await check();
    if (result) return result;
    await sleep(250);
  }
  throw new Error(`Timed out: ${description}`);
}

async function instances(service) {
  const ids = (await compose(['ps', '-q', service])).split(/\s+/).filter(Boolean);
  if (!ids.length) return [];
  const lines = (await docker(['inspect', '--format', '{{.Id}} {{.Config.Hostname}}', ...ids])).split(/\r?\n/);
  return lines.map((line) => {
    const [id, hostname] = line.split(' ');
    return { id, hostname };
  });
}

async function stop(instance) {
  stopped.add(instance.id);
  await docker(['stop', '--time', '2', instance.id]);
}

async function restore(instance) {
  await docker(['start', instance.id]);
  stopped.delete(instance.id);
}

async function request(path) {
  const start = performance.now();
  try {
    const response = await fetch(`${API}${path}`, { signal: AbortSignal.timeout(5000) });
    const body = await response.json().catch(() => null);
    const ok = response.status === 200 && (path.startsWith('/health') ? body?.status === 'ok' : Array.isArray(body?.data ?? body));
    return { ok, status: response.status, instance: response.headers.get('x-served-by'), ms: performance.now() - start };
  } catch {
    return { ok: false, status: 0, instance: null, ms: performance.now() - start };
  }
}

async function waitForGateways(total) {
  await waitFor(`${total} reachable Gateway replicas`, async () => {
    const ids = new Set();
    for (let i = 0; i < 9; i++) {
      const result = await request('/health/live');
      if (result.ok && result.instance) ids.add(result.instance);
    }
    return ids.size === total;
  });
}

async function measureFailover() {
  report('stage', { name: 'load' });
  const gateways = await instances('api-gateway');
  assert.equal(gateways.length, 3, 'Expected 3 running API Gateways');
  await waitForGateways(3);
  assert.ok((await request('/health')).ok, 'The backend services must be healthy');
  const victim = gateways[1];
  const results = [];
  const counts = Object.fromEntries(gateways.map(({ hostname }) => [hostname, { before: 0, stopping: 0, after: 0 }]));
  let phase = 'before';
  let stopResult;
  let failed = 0;
  report('load-start', { total: TOTAL, victim: victim.hostname, counts });
  for (let i = 0; i < TOTAL; i += 10) {
    if (i === 200) {
      phase = 'stopping';
      report('gateway-stopping', { instance: victim.hostname });
      stopResult = stop(victim).then(() => {
        phase = 'after';
        report('gateway-stopped', { instance: victim.hostname });
        return null;
      }, (err) => err);
    }
    const batchPhase = phase;
    const batch = await Promise.all(Array.from({ length: 10 }, (_, index) =>
      request(index % 2 ? '/categories' : '/products?limit=2'),
    ));
    results.push(...batch.map((result) => ({ ...result, phase: batchPhase })));
    for (const result of batch) {
      if (!result.ok) {
        failed++;
        continue;
      }
      assert.ok(Object.hasOwn(counts, result.instance), 'Every successful response must identify its Gateway');
      counts[result.instance][batchPhase]++;
    }
    report('load-progress', { sent: results.length, failed, total: TOTAL, phase, counts });
    await sleep(120);
  }
  const stopError = await stopResult;
  if (stopError) throw stopError;

  const before = results.filter((r) => r.phase === 'before' && r.ok);
  const after = results.filter((r) => r.phase === 'after' && r.ok);
  const failures = results.filter((r) => !r.ok);
  console.log(`\nHTTP failover: ${TOTAL - failures.length}/${TOTAL} successful, stopped ${victim.hostname}`);
  console.table(counts);
  const times = results.map((r) => r.ms).sort((a, b) => a - b);
  const p95 = Math.round(times[Math.ceil(TOTAL * 0.95) - 1]);
  console.log(`p95 ${p95} ms, failed status codes: ${failures.map((r) => r.status).join(', ') || 'none'}`);
  report('load-result', { sent: results.length, failed, p95, total: TOTAL, counts, victim: victim.hostname });
  assert.equal(new Set(before.map((r) => r.instance)).size, 3);
  assert.equal(new Set(after.map((r) => r.instance)).size, 2);
  assert.ok(after.length >= 20, 'The run must continue after Docker confirms the stop');
  assert.ok(after.every((r) => r.instance !== victim.hostname));
  assert.ok(failures.length <= 5, 'More than 1% of HTTP requests failed');
  await restore(victim);
  await waitForGateways(3);
  report('gateway-restored', { instance: victim.hostname });
  console.log('The restored Gateway is serving requests again.');
}

function subscribeAdmin(socket) {
  return new Promise((resolve, reject) => {
    socket.timeout(4000).emit('subscribe', { channel: 'admin.orders' }, (err, result) => {
      if (err || !result?.ok) return reject(err ?? new Error('Missing admin.orders subscription'));
      resolve();
    });
  });
}

function adminSocket(token) {
  return new Promise((resolve, reject) => {
    const socket = io(WS, {
      auth: { token }, transports: ['websocket'], forceNew: true, autoConnect: false,
      reconnection: false, timeout: 4000,
    });
    sockets.push(socket);
    const events = [];
    let hostname;
    socket.on('order.created', (order) => events.push(order.orderId));
    socket.once('connect_error', reject);
    socket.once('connect', async () => {
      try {
        assert.ok(hostname, 'Missing WebSocket instance header');
        await subscribeAdmin(socket);
        resolve({ hostname, events, socket });
      } catch (err) {
        reject(err);
      }
    });
    socket.connect();
    socket.io.engine.transport.ws.once('upgrade', (response) => {
      hostname = response.headers['x-served-by'];
    });
  });
}

async function mailCount(orderId) {
  const result = await fetch(`${MAILPIT}/api/v1/messages?limit=100`, { signal: AbortSignal.timeout(3000) });
  assert.ok(result.ok, 'Could not read the Mailpit inbox');
  const { messages } = await result.json();
  return (messages ?? []).filter((message) => message.Subject?.includes(`#${orderId.slice(0, 8)} `)).length;
}

async function verifyWorkersAndSockets() {
  report('stage', { name: 'workers' });
  assert.equal(await compose(['exec', '-T', 'email-worker', 'printenv', 'SMTP_HOST']), 'mailpit', 'The email demo requires the local Mailpit');
  const rabbit = await amqp.connect(RABBIT);
  try {
    const channel = await rabbit.createConfirmChannel();
    const workers = await instances('email-worker');
    assert.equal(workers.length, 3);
    await waitFor('3 consumers of the same email queue', async () => (await channel.checkQueue(EMAIL_QUEUE)).consumerCount === 3);
    report('worker-count', { count: 3 });
    const admin = await login(process.env.ADMIN_EMAIL ?? 'admin@shop.local', process.env.ADMIN_PASSWORD ?? 'Admin@12345');
    const name = `Req5 ${randomUUID().slice(0, 8)}`;
    const email = `${name.replace(' ', '-').toLowerCase()}@shop.local`;
    const customer = await api('POST', '/auth/register', { body: { name, email, password: 'Customer@123' } });
    assert.equal(customer.status, 201, JSON.stringify(customer.body));
    const product = await api('POST', '/products', { token: admin.token, body: { name, description: 'Requirement 5 fixture', price: 12, stock: 5 } });
    assert.equal(product.status, 201, JSON.stringify(product.body));

    const observers = [];
    for (let i = 0; i < 3; i++) observers.push(await adminSocket(admin.token));
    assert.equal(new Set(observers.map((socket) => socket.hostname)).size, 3);
    const victim = workers[1];
    await stop(victim);
    await waitFor('2 consumers after stopping one worker', async () => (await channel.checkQueue(EMAIL_QUEUE)).consumerCount === 2);
    report('worker-count', { count: 2, instance: victim.hostname });

    const order = await api('POST', '/orders', {
      token: customer.body.accessToken,
      body: { shippingAddress: 'Damascus, requirement 5 demo', items: [{ productId: product.body.id, quantity: 1 }] },
    });
    assert.equal(order.status, 201, JSON.stringify(order.body));
    await waitFor('the live order on all 3 Socket.IO replicas', () => observers.every((socket) => socket.events.includes(order.body.id)));
    await waitFor('confirmation email with only 2 workers', async () => (await mailCount(order.body.id)) === 1);
    assert.ok(observers.every((socket) => socket.events.filter((id) => id === order.body.id).length === 1));
    console.log(`WebSocket: order.created reached all 3 replicas once (${observers.map((socket) => socket.hostname).join(', ')}).`);
    console.log('Email: 3 consumers before stop, 2 after stop, and 1 confirmation for the real order.');
    report('live-order', { recipients: observers.length, emails: 1, order: order.body.id.slice(0, 8) });
    for (const observer of observers) observer.socket.disconnect();

    await restore(victim);
    await waitFor('3 consumers after restart', async () => (await channel.checkQueue(EMAIL_QUEUE)).consumerCount === 3);
    report('worker-count', { count: 3, instance: victim.hostname });
    const duplicateId = randomUUID();
    const payload = Buffer.from(JSON.stringify({ pattern: 'order.created', data: {
      orderId: duplicateId, customerEmail: email, total: 12, createdAt: new Date().toISOString(),
      shippingAddress: 'Damascus, duplicate test', items: [{ name, quantity: 1, unitPrice: 12 }],
    } }));
    for (let i = 0; i < 9; i++) channel.sendToQueue(EMAIL_QUEUE, payload, { persistent: true });
    await channel.waitForConfirms();
    await waitFor('the duplicate fixture email', async () => (await mailCount(duplicateId)) === 1);
    await waitFor('duplicate deliveries to be skipped', async () => {
      const logs = await compose(['logs', '--since', '3m', 'email-worker']);
      const ref = `#${duplicateId.slice(0, 8)}:`;
      return logs.split('\n').filter((line) => line.includes(ref) && line.includes('skipping the duplicate')).length === 8;
    });
    assert.equal(await mailCount(duplicateId), 1);
    console.log('Email duplicate test: 9 messages for one order, 8 skipped, 1 email in Mailpit.');
    report('duplicate-result', { messages: 9, skipped: 8, emails: 1, order: duplicateId.slice(0, 8) });
  } finally {
    await rabbit.close();
  }
}

async function verifySocketReconnect() {
  report('stage', { name: 'socket' });
  const admin = await login(process.env.ADMIN_EMAIL ?? 'admin@shop.local', process.env.ADMIN_PASSWORD ?? 'Admin@12345');
  const { hostname, socket } = await adminSocket(admin.token);
  const victim = (await instances('notifications-service')).find((instance) => instance.hostname === hostname);
  assert.ok(victim, 'Socket server must belong to this Compose project');
  report('socket-stopping', { instance: hostname });
  await stop(victim);
  assert.equal((await instances('notifications-service')).length, 2);
  socket.disconnect();
  const reopened = await waitFor('a new Socket.IO connection and subscription with the same token', async () => {
    try {
      return await adminSocket(admin.token);
    } catch {
      return false;
    }
  });
  assert.notEqual(reopened.hostname, hostname, 'The new connection must use a healthy replica');
  report('socket-result', { remaining: 2, channel: 'admin.orders' });
  console.log('The Socket.IO client reopened its connection with the same token and rejoined admin.orders.');
  reopened.socket.disconnect();
  await restore(victim);
  await waitFor('restored WebSocket replica to accept connections', async () => {
    const probe = await adminSocket(admin.token);
    probe.socket.disconnect();
    return probe.hostname === hostname;
  });
  report('socket-restored', { instance: hostname });
}

async function verifyRateLimit() {
  report('stage', { name: 'rate' });
  const seen = new Set();
  async function invalidLogin() {
    const response = await fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(4000),
    });
    await response.arrayBuffer();
    seen.add(response.headers.get('x-served-by'));
    return response;
  }
  const first = await invalidLogin();
  assert.equal(first.status, 400, 'The login test needs a fresh rate-limit window');
  const left = Number(first.headers.get('x-ratelimit-remaining'));
  assert.ok(left >= 3 && left < 1000, 'Wait one minute for a fresh login limit window');
  for (let i = 0; i < left; i++) assert.equal((await invalidLogin()).status, 400);
  assert.equal((await invalidLogin()).status, 429);
  assert.equal(seen.size, 3);
  console.log(`Rate limit: ${left + 1} requests used the remaining allowance across 3 Gateways, the next returned HTTP 429.`);
  report('rate-result', {
    allowed: left + 1,
    limit: Number(first.headers.get('x-ratelimit-limit')),
    replicas: seen.size,
    status: 429,
  });
}

try {
  if (process.argv.includes('--workers-only')) {
    await verifyWorkersAndSockets();
  } else if (process.argv.includes('--socket-only')) {
    await verifySocketReconnect();
  } else if (process.argv.includes('--rate-only')) {
    await verifyRateLimit();
  } else if (process.argv.includes('--load-only')) {
    await measureFailover();
  } else {
    await measureFailover();
    await verifyWorkersAndSockets();
    await verifySocketReconnect();
    await verifyRateLimit();
  }
} finally {
  for (const socket of sockets) socket.disconnect();
  for (const id of stopped) await restore({ id });
}
