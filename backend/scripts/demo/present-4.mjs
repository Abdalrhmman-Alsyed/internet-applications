// Requirement 4: gets the two-browser presentation ready in one click.   npm run present:4
//
//  - starts the containers if needed and waits until every service is up
//  - puts the email worker back to normal settings
//  - opens two separate Edge windows side by side (separate profiles, like two devices):
//      left  = admin, already signed in, on the Orders page (+ Mailpit and RabbitMQ tabs)
//      right = customer Ahmad, already signed in, on "My orders" (/track)
//  - prints an order ID of Sara's for the "someone else's order → 403" scene
import { existsSync, mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { ACCOUNTS, api, bold, compose, cyan, dim, green, login, red, sleep, waitApi, yellow } from './lib.mjs';

const WEB = 'http://localhost:3001';
const API_URL = 'http://localhost:3000/api/v1';
const EDGE = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].find(existsSync);
const PROFILES = join(process.env.LOCALAPPDATA ?? process.cwd(), 'ecommerce-demo-browsers');

const say = (t) => console.log(`  ${t}`);

async function ensureStack() {
  say('Checking the containers...');
  let healthy = false;
  try {
    healthy = (await fetch(`${API_URL}/health`).then((r) => r.json())).status === 'ok';
  } catch {}
  if (!healthy) {
    say(yellow('Not everything is up: running docker compose up -d (can take a minute)...'));
    compose(['up', '-d'], {}, { quiet: false });
  }
  // Normal settings for the worker (an earlier demo may have left it in failure mode or stopped)
  compose(['up', '-d', 'email-worker', 'mailpit']);
  for (let i = 0; i < 90; i++) {
    try {
      if ((await fetch(`${API_URL}/health`).then((r) => r.json())).status === 'ok') return true;
    } catch {}
    await sleep(2000);
  }
  return false;
}

// ─── Chrome DevTools Protocol (Edge speaks it too) ───
async function cdpTargets(port) {
  for (let i = 0; i < 40; i++) {
    try {
      return await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json());
    } catch {
      await sleep(250);
    }
  }
  throw new Error(`Edge did not open its debugging port ${port}`);
}

function cdpSession(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let id = 0;
    const pending = new Map();
    ws.onmessage = (m) => {
      const msg = JSON.parse(m.data);
      if (msg.id && pending.has(msg.id)) {
        pending.get(msg.id)(msg);
        pending.delete(msg.id);
      }
    };
    ws.onerror = reject;
    ws.onopen = () =>
      resolve({
        send: (method, params = {}) =>
          new Promise((res) => {
            const n = ++id;
            pending.set(n, res);
            ws.send(JSON.stringify({ id: n, method, params }));
          }),
        close: () => ws.close(),
      });
  });
}

async function evaluate(s, expression) {
  const r = await s.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  return r.result?.result?.value;
}

async function goto(s, url) {
  await s.send('Page.navigate', { url });
  for (let i = 0; i < 60; i++) {
    await sleep(250);
    const ready = await evaluate(s, `document.readyState === 'complete' && location.href.startsWith(${JSON.stringify(url.split('#')[0])})`);
    if (ready) return;
  }
}

/** Opens (or reuses) an Edge window with its own profile, at the given half of the screen. */
async function openWindow(name, port, x, width, height, urls) {
  const dir = join(PROFILES, name);
  mkdirSync(dir, { recursive: true });
  // A window left over from an earlier run: close it first, so there is exactly one.
  try {
    const old = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json());
    for (const t of old.filter((t) => t.type === 'page')) await fetch(`http://127.0.0.1:${port}/json/close/${t.id}`);
    await sleep(2000);
  } catch {}
  spawn(
    EDGE,
    [
      `--user-data-dir=${dir}`,
      `--remote-debugging-port=${port}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-features=msEdgeSidebarV2,EdgeCollections',
      `--window-position=${x},0`,
      `--window-size=${width},${height}`,
      '--new-window',
      ...urls,
    ],
    { detached: true, stdio: 'ignore' },
  ).unref();
  let pages = [];
  for (let i = 0; i < 40 && pages.length < urls.length; i++) {
    pages = (await cdpTargets(port)).filter((t) => t.type === 'page' && urls.some((u) => t.url.startsWith(u.replace(/\/$/, ''))));
    if (pages.length < urls.length) await sleep(250);
  }
  const find = (u) => pages.find((t) => t.url.startsWith(u.replace(/\/$/, '')));
  const target = find(urls[0]);
  return { port, target, tabs: urls.map(find), session: await cdpSession(target.webSocketDebuggerUrl) };
}

/** Signs in through the real API and stores the tokens exactly like the login page does. */
async function signIn(win, [email, password], path) {
  await goto(win.session, `${WEB}/login`);
  const ok = await evaluate(
    win.session,
    `(async () => {
      const r = await fetch(${JSON.stringify(API_URL)} + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: ${JSON.stringify(email)}, password: ${JSON.stringify(password)} }) });
      if (!r.ok) return 'HTTP ' + r.status;
      const b = await r.json();
      localStorage.setItem('ecommerce.tokens', JSON.stringify({ accessToken: b.accessToken, refreshToken: b.refreshToken }));
      return 'ok';
    })()`,
  );
  if (ok !== 'ok') throw new Error(`Sign-in of ${email} failed (${ok}). If it is HTTP 429, wait one minute and run again.`);
  await goto(win.session, `${WEB}${path}`);
}

async function main() {
  console.log(`\n${bold('  Requirement 4: getting the two-browser presentation ready')}\n`);
  if (!EDGE) throw new Error('Microsoft Edge was not found');

  if (!(await ensureStack())) throw new Error('The services did not come up. Open Docker Desktop and run: docker compose up -d');
  if (!(await waitApi(30))) throw new Error('The API is not reachable');
  say(green('✔ all 14 containers up, every service healthy, email worker on normal settings'));

  // Screen size: two halves
  let W = 1536,
    H = 816;
  try {
    const { execFileSync } = await import('node:child_process');
    const out = execFileSync('powershell', ['-NoProfile', '-Command', 'Add-Type -AssemblyName System.Windows.Forms; $a=[System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea; "$($a.Width) $($a.Height)"'], { encoding: 'utf8' }).trim().split(' ').map(Number);
    if (out[0] > 0) [W, H] = out;
  } catch {}
  const half = Math.floor(W / 2);

  // Left: admin
  const admin = await openWindow('admin', 9301, 0, half, H, [`${WEB}/login`, 'http://localhost:8025/', 'http://localhost:15672/']);
  await signIn(admin, ACCOUNTS.admin, '/orders');
  // Extra tabs: inbox and queues (RabbitMQ signed in too)
  const [, mail, rabbit] = admin.tabs;
  const rs = await cdpSession(rabbit.webSocketDebuggerUrl);
  for (let i = 0; i < 40; i++) {
    await sleep(250);
    if (await evaluate(rs, `!!document.querySelector('input[name=username]')`)) break;
  }
  await evaluate(
    rs,
    `(() => { const f = document.querySelector('input[name=username]')?.form; if (!f) return;
      f.querySelector('input[name=username]').value = 'app'; f.querySelector('input[name=password]').value = 'app_password';
      f.querySelector('input[type=submit]').click(); })()`,
  );
  await sleep(1500);
  await evaluate(rs, `location.hash = '#/queues'`);
  rs.close();
  await fetch(`http://127.0.0.1:9301/json/activate/${admin.target.id}`);
  const adminLive = await waitBadge(admin.session, 'Live: admin.orders');

  // Right: customer Ahmad
  const ahmad = await openWindow('ahmad', 9302, half, W - half, H, [`${WEB}/login`]);
  await signIn(ahmad, ACCOUNTS.ahmad, '/track');
  const ahmadLive = await waitBadge(ahmad.session, 'live: order:');

  // An order of Sara's, for the 403 scene
  const sara = await login(...ACCOUNTS.sara);
  let saraOrder = (await api('GET', '/orders?limit=1', { token: sara.token })).body?.data?.[0]?.id;

  admin.session.close();
  ahmad.session.close();

  // A fresh profile can open its own welcome tabs (extensions, first run): close every tab
  // that is not ours and bring the main page of each window to the front.
  await sleep(2000);
  const keep = new Set([admin.target.id, mail?.id, rabbit?.id, ahmad.target.id]);
  for (const [port, main] of [[9301, admin.target.id], [9302, ahmad.target.id]]) {
    for (const t of (await cdpTargets(port)).filter((x) => x.type === 'page')) {
      if (!keep.has(t.id)) await fetch(`http://127.0.0.1:${port}/json/close/${t.id}`).catch(() => undefined);
    }
    await fetch(`http://127.0.0.1:${port}/json/activate/${main}`).catch(() => undefined);
  }

  console.log('');
  say(`${adminLive ? green('✔') : red('✖')} LEFT  window: admin on Orders${adminLive ? ', channel "admin.orders" live' : ' (press F5 if the badge is not green)'}`);
  say(dim('               tabs: Mailpit (emails) · RabbitMQ (queues, signed in as app)'));
  say(`${ahmadLive ? green('✔') : red('✖')} RIGHT window: Ahmad on "My orders"${ahmadLive ? ', his order channel live' : ' (press F5 if the badge is not green)'}`);
  console.log('');
  say(bold('Sara\'s order for the 403 scene (paste it in "Try to follow someone else\'s order"):'));
  say(cyan(saraOrder ?? '(Sara has no orders: take any order ID that is not Ahmad\'s from the admin window)'));
  console.log('');
  say(`Script: ${cyan('docs\\TWO-BROWSERS-SCRIPT.pdf')}   ·   for scene 6: ${cyan('docker compose stop email-worker')} / ${cyan('docker compose start email-worker')}`);
  console.log('');
}

async function waitBadge(s, text) {
  for (let i = 0; i < 40; i++) {
    if (await evaluate(s, `document.body.innerText.includes(${JSON.stringify(text)})`)) return true;
    await sleep(250);
  }
  return false;
}

main().catch((err) => {
  console.log(red(`\n  ✖ ${err.message}\n`));
  process.exitCode = 1;
});
