// Requirement 4 demo: asynchronous queues (RabbitMQ) and real-time channels (Socket.io).   npm run demo:4
import * as amqp from 'amqplib';
import { io } from 'socket.io-client';
import { ACCOUNTS, answer, api, bold, compose, confirm, cyan, dim, green, login, ok, pause, preflight, red, run, say, show, sleep, step, table, title, waitRunning, yellow } from './lib.mjs';

const RABBIT = process.env.RABBITMQ_URL ?? 'amqp://app:app_password@localhost:5672';
const MGMT = process.env.RABBITMQ_MANAGEMENT_URL ?? 'http://localhost:15672';
const MGMT_AUTH = 'Basic ' + Buffer.from('app:app_password').toString('base64');
const MAILPIT = process.env.MAILPIT_URL ?? 'http://localhost:8025';
const WS = process.env.WS_URL ?? new URL(process.env.API_URL ?? 'http://localhost:3000').origin;
const QUEUES = ['notifications.events', 'email.order-created', 'email.retry', 'email.dead', 'notifications.dead'];

let admin, ahmad, sara, product;
let rabbit, ch;
let workerChanged = false;
let mailpitStopped = false;
let workerStopped = false;
const sockets = [];

const ref = (id) => `#${id.slice(0, 8)}`;

async function counts() {
  const out = {};
  for (const q of QUEUES) {
    const r = await ch.checkQueue(q);
    out[q] = { waiting: r.messageCount, consumers: r.consumerCount };
  }
  return out;
}
function showCounts(c, only = QUEUES) {
  table([['queue', 'waiting', 'consumers'], ...only.map((q) => [q, String(c[q].waiting), String(c[q].consumers)])]);
}

const usesMailpit = () => {
  try {
    const env = compose(['exec', '-T', 'email-worker', 'printenv', 'SMTP_HOST']);
    return env === 'mailpit' || env === 'localhost';
  } catch {
    return true;
  }
};

/** True once the worker logged that the email of this order was sent. */
function emailSent(orderId) {
  const logs = compose(['logs', '--since', '10m', 'email-worker']);
  return logs.includes(`${ref(orderId)}: confirmation sent`);
}
async function mailpitHas(orderId) {
  try {
    const r = await fetch(`${MAILPIT}/api/v1/messages?limit=100`).then((x) => x.json());
    return r.messages?.find((m) => m.Subject?.includes(ref(orderId)));
  } catch {
    return undefined;
  }
}
async function waitEmail(orderId, seconds = 20) {
  const t0 = Date.now();
  for (let i = 0; i < seconds * 4; i++) {
    if (emailSent(orderId)) return Date.now() - t0;
    await sleep(250);
  }
  return null;
}

async function placeOrder(user, note = 'Requirement 4 demo') {
  const t0 = performance.now();
  const r = await api('POST', '/orders', {
    token: user.token,
    body: { items: [{ productId: product.id, quantity: 1 }], shippingAddress: 'Damascus, Mazzeh, Street 12', note },
  });
  return { ...r, ms: Math.round(performance.now() - t0) };
}

function connectSocket(token) {
  return new Promise((resolve) => {
    const s = io(WS, { auth: token ? { token } : {}, transports: ['websocket'], reconnection: false, timeout: 4000 });
    sockets.push(s);
    // The server checks the token right after the handshake and closes the socket if it is bad.
    s.on('connect', () => setTimeout(() => resolve({ socket: s, connected: s.connected, error: s.connected ? undefined : 'closed by the server (401)' }), 500));
    s.on('connect_error', (e) => resolve({ socket: s, connected: false, error: e.message }));
  });
}
const subscribe = (s, payload) =>
  new Promise((resolve) => s.timeout(4000).emit('subscribe', payload, (err, a) => resolve(err ? { ok: false, status: 0, message: 'no answer (socket not connected)' } : a)));
const fmt = (a) => (a?.ok ? green(`ok · joined ${a.channel}`) : red(`${a?.status} · ${a?.message}`));
function waitEvent(s, name, filter = () => true, ms = 5000) {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(null), ms);
    s.on(name, (data) => {
      if (filter(data)) {
        clearTimeout(t);
        resolve(data);
      }
    });
  });
}

await run(
  async () => {
    await preflight();
    title('Requirement 4: asynchronous queues and real-time', 'Order → RabbitMQ → email worker (ack, retries, DLQ) · Socket.io channels with authorization');

    rabbit = await amqp.connect(RABBIT);
    ch = await rabbit.createChannel();
    admin = await login(...ACCOUNTS.admin);
    ahmad = await login(...ACCOUNTS.ahmad);
    sara = await login(...ACCOUNTS.sara);
    product = (await api('GET', '/products?limit=50')).body.data.find((p) => p.stock > 20) ?? (await api('GET', '/products?limit=50')).body.data[0];
    if (product.stock < 20) await api('PATCH', `/products/${product.id}/stock`, { token: admin.token, body: { stock: 100 } });

    // ─── 1 ───
    await step('The message topology in RabbitMQ', 'orders-service publishes ONE event to the "events" exchange. Every consumer has its own queue, so each gets a copy.');
    const bindings = await fetch(`${MGMT}/api/exchanges/%2F/events/bindings/source`, { headers: { Authorization: MGMT_AUTH } }).then((r) => r.json());
    table([['exchange', 'routing key', '→ queue'], ...bindings.filter((b) => /^(order|product|user)\./.test(b.routing_key)).map((b) => ['events (topic)', b.routing_key, b.destination])]);
    say(dim('email.order-created  → on reject: email.dlx → email.dead       (dead-letter queue)'));
    say(dim('email.retry          → after the delay: back to email.order-created'));
    say(dim('notifications.events → on reject: notifications.dlx → notifications.dead'));
    showCounts(await counts());
    show('worker', compose(['ps', 'email-worker', '--format', '{{.Name}}  {{.Status}}']));
    show('SMTP', usesMailpit() ? `Mailpit (local inbox)  → open ${cyan(MAILPIT)}` : 'external service from .env');

    // ─── 2 ───
    await step('Placing an order answers at once; the email is sent in the background', 'The API does not wait for SMTP: it publishes the event and returns 201.');
    const o1 = await placeOrder(ahmad);
    say(`POST /orders  →  ${answer(o1)}  in ${bold(o1.ms + ' ms')}   order ${ref(o1.body.id)}`);
    const t1 = await waitEmail(o1.body.id);
    ok(t1 !== null, `email-worker sent the confirmation ${t1} ms after the order was answered`);
    const m1 = await mailpitHas(o1.body.id);
    if (m1) show('in the inbox', `"${m1.Subject}" → ${m1.To?.[0]?.Address}`);

    // ─── 3 ───
    await step('Stop the worker: orders still work, messages wait in the queue', 'Nothing is lost: the queue is durable and messages are persistent.');
    compose(['stop', 'email-worker']);
    workerStopped = true;
    say(red('email-worker stopped'));
    const waiting = [];
    for (let i = 0; i < 3; i++) {
      const r = await placeOrder(ahmad);
      waiting.push(r.body.id);
      say(`POST /orders  →  ${answer(r)}  in ${r.ms} ms   order ${ref(r.body.id)}`);
    }
    await sleep(800);
    const c3 = await counts();
    showCounts(c3, ['email.order-created']);
    ok(c3['email.order-created'].waiting >= 3, `${c3['email.order-created'].waiting} messages are waiting, 0 consumers, no email sent yet`);
    await pause('Press Enter to start the worker again');
    compose(['start', 'email-worker']);
    workerStopped = false;
    await waitRunning('email-worker');
    const sent3 = [];
    for (const id of waiting) sent3.push(await waitEmail(id, 30));
    ok(sent3.every((x) => x !== null), `all ${waiting.length} emails sent after the restart: ${waiting.map(ref).join(', ')}`);
    showCounts(await counts(), ['email.order-created']);

    // ─── 4 ───
    if (usesMailpit()) {
      await step('The mail server is down: the worker retries later', 'A failed send is NOT acknowledged as done: a copy waits in email.retry (5 s, 30 s, 2 min) and comes back.');
      compose(['stop', 'mailpit']);
      mailpitStopped = true;
      say(red('mail server (Mailpit) stopped'));
      const o4 = await placeOrder(ahmad);
      say(`POST /orders  →  ${answer(o4)}  in ${o4.ms} ms   order ${ref(o4.body.id)}`);
      let failLine;
      for (let i = 0; i < 40 && !failLine; i++) {
        await sleep(500);
        failLine = compose(['logs', '--since', '1m', 'email-worker']).split('\n').find((l) => l.includes(ref(o4.body.id)) && l.includes('failed'));
      }
      show('worker log', yellow(failLine?.replace(/\x1b\[[0-9;]*m/g, '').replace(/^.*\[EmailWorker\] /, '').slice(0, 140) ?? '(no failure yet)'));
      showCounts(await counts(), ['email.retry']);
      compose(['start', 'mailpit']);
      mailpitStopped = false;
      say(green('mail server started again, waiting for the retry...'));
      const t4 = await waitEmail(o4.body.id, 45);
      ok(t4 !== null, `email sent on a later attempt (${t4} ms after the mail server came back)`);
      const okLine = compose(['logs', '--since', '2m', 'email-worker']).split('\n').find((l) => l.includes(ref(o4.body.id)) && l.includes('sent'));
      show('worker log', green(okLine?.replace(/\x1b\[[0-9;]*m/g, '').replace(/^.*\[EmailWorker\] /, '').slice(0, 140) ?? ''));
    }

    // ─── 5 ───
    await step('A message that ALWAYS fails ends in the dead-letter queue', 'After 4 attempts the worker rejects it; RabbitMQ moves it (via the DLX) to email.dead. Other messages keep flowing.');
    compose(['up', '-d', 'email-worker'], { SIMULATE_EMAIL_FAILURE: 'always', EMAIL_RETRY_DELAYS_MS: '1000,2000,3000' });
    workerChanged = true;
    await waitRunning('email-worker');
    say(yellow('worker restarted with SIMULATE_EMAIL_FAILURE=always and short delays (1 s, 2 s, 3 s)'));
    const deadBefore = (await counts())['email.dead'].waiting;
    const o5 = await placeOrder(ahmad);
    say(`POST /orders  →  ${answer(o5)}  in ${o5.ms} ms   order ${ref(o5.body.id)}`);
    let deadNow = deadBefore;
    for (let i = 0; i < 40 && deadNow === deadBefore; i++) {
      await sleep(500);
      deadNow = (await counts())['email.dead'].waiting;
    }
    compose(['logs', '--since', '1m', 'email-worker']).split('\n').filter((l) => l.includes(ref(o5.body.id))).forEach((l) => say(dim(l.replace(/\x1b\[[0-9;]*m/g, '').replace(/^.*\[EmailWorker\] /, '').slice(0, 130))));
    ok(deadNow > deadBefore, `email.dead: ${deadBefore} → ${deadNow}`);
    const dead = await ch.get('email.dead', { noAck: false });
    if (dead) {
      const death = dead.properties.headers?.['x-death']?.[0];
      show('dead message', `order ${ref(JSON.parse(dead.content).data.orderId)}  attempts ${dead.properties.headers?.['x-attempt']}`);
      show('x-death', `reason=${death?.reason}  queue=${death?.queue}  exchange=${death?.exchange}`);
      show('last error', dead.properties.headers?.['x-last-error'] ?? '');
      ch.nack(dead, false, true); // leave it in the DLQ
    }
    compose(['up', '-d', 'email-worker']);
    workerChanged = false;
    await waitRunning('email-worker');
    say(green('worker back to normal settings'));
    if (await confirm('Replay the dead messages now that the worker is healthy?')) {
      let moved = 0;
      for (let m = await ch.get('email.dead', { noAck: false }); m; m = await ch.get('email.dead', { noAck: false })) {
        const { 'x-death': _d, 'x-first-death-exchange': _e, 'x-first-death-queue': _q, 'x-first-death-reason': _r, ...headers } = m.properties.headers ?? {};
        ch.sendToQueue('email.order-created', m.content, { persistent: true, contentType: m.properties.contentType, headers: { ...headers, 'x-attempt': 1 } });
        ch.ack(m);
        moved++;
      }
      const t5 = await waitEmail(o5.body.id, 20);
      ok(t5 !== null, `${moved} message(s) moved back to email.order-created, the email of ${ref(o5.body.id)} was sent`);
    }

    // ─── 6 ───
    await step('Real-time channels: identity and permission are checked BEFORE joining', 'Two channels: "admin.orders" (admins only) and "order:<id>" (only the order owner).');
    const anon = await connectSocket(null);
    say(`no token                      →  ${anon.connected ? red('still connected') : green('refused: ' + anon.error)}`);
    const forged = await connectSocket('forged.token.value');
    say(`forged token                  →  ${forged.connected ? red('still connected') : green('refused: ' + forged.error)}`);
    const sAdmin = (await connectSocket(admin.token)).socket;
    const sAhmad = (await connectSocket(ahmad.token)).socket;
    const sSara = (await connectSocket(sara.token)).socket;
    say(`admin  → admin.orders         →  ${fmt(await subscribe(sAdmin, { channel: 'admin.orders' }))}`);
    say(`ahmad  → admin.orders         →  ${fmt(await subscribe(sAhmad, { channel: 'admin.orders' }))}`);
    const o6 = await placeOrder(ahmad, 'Live channel demo');
    say(`ahmad  → order ${ref(o6.body.id)}       →  ${fmt(await subscribe(sAhmad, { channel: 'order', orderId: o6.body.id }))}`);
    say(`sara   → order ${ref(o6.body.id)}       →  ${fmt(await subscribe(sSara, { channel: 'order', orderId: o6.body.id }))}`);

    await step('A new order appears on the admin channel instantly', 'notifications-service consumes order.created and pushes it to the "admin.orders" room.');
    const gotNew = waitEvent(sAdmin, 'order.created');
    const tNew = performance.now();
    const o7 = await placeOrder(ahmad, 'Admin live demo');
    const ev = await gotNew;
    ok(ev?.orderId === o7.body.id, `admin received order.created ${ref(o7.body.id)} ${Math.round(performance.now() - tNew)} ms after POST /orders started (${ev?.customerEmail}, $${ev?.total})`);

    await step('The admin confirms an order: the customer sees it instantly, others see nothing', 'PATCH /orders/:id/status → order.status_changed → pushed to "order:<id>" only.');
    let saraGot = false;
    sSara.on('order.status', () => (saraGot = true));
    const gotStatus = waitEvent(sAhmad, 'order.status', (d) => d.orderId === o6.body.id);
    const tStatus = performance.now();
    const patch = await api('PATCH', `/orders/${o6.body.id}/status`, { token: admin.token, body: { status: 'CONFIRMED' } });
    const st = await gotStatus;
    say(`PATCH /orders/${ref(o6.body.id)}/status CONFIRMED  →  ${answer(patch)}`);
    ok(st?.to === 'CONFIRMED', `ahmad received order.status ${st?.from} → ${st?.to} in ${Math.round(performance.now() - tStatus)} ms`);
    await sleep(800);
    ok(!saraGot, 'sara (not the owner) received nothing');

    // ─── 7 ───
    await step('Now in two browsers', 'Same thing, with the real pages.');
    say(`1. Browser A (normal window):     ${cyan('http://localhost:3001')}  → sign in as ${bold('admin@shop.local')}  → Orders`);
    say(`2. Browser B (incognito window):  ${cyan('http://localhost:3001')}  → sign in as ${bold('ahmad@shop.local')}  → My orders (/track)`);
    say(`3. In B press "Place a test order"  → it appears in A at once (green "New orders received live" bar)`);
    say(`4. In A open that order → "Mark confirmed"  → B changes to CONFIRMED without refresh`);
    say(`5. Emails: ${cyan(MAILPIT)}    Queues: ${cyan('http://localhost:15672')} (app / app_password)`);
    await pause('Press Enter to finish');
  },
  async () => {
    sockets.forEach((s) => s.disconnect());
    if (workerStopped || workerChanged) {
      console.log(dim('  restoring email-worker to normal settings...'));
      compose(['up', '-d', 'email-worker']);
    }
    if (mailpitStopped) compose(['start', 'mailpit']);
    await rabbit?.close().catch(() => undefined);
  },
);
