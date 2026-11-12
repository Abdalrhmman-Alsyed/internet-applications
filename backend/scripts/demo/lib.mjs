// Shared helpers for the three presentation scripts (demo-1/2/3.mjs).
// Each step prints what it does and why, runs, shows the result, then waits for Enter.
// Run with --auto to skip the pauses (used to test the scripts).
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

export const API = process.env.API_URL ?? 'http://localhost:3000/api/v1';
export const BACKEND = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const COMPOSE = join(BACKEND, '..', 'docker-compose.yml');
const AUTO = process.argv.includes('--auto');

// ─── Output ───
const c = (code) => (s) => `\x1b[${code}m${s}\x1b[0m`;
export const bold = c('1');
export const dim = c('2');
export const green = c('32');
export const red = c('31');
export const yellow = c('33');
export const cyan = c('36');

export function title(text, sub) {
  const line = '═'.repeat(70);
  console.log(`\n${cyan(line)}\n${bold(`  ${text}`)}${sub ? `\n  ${dim(sub)}` : ''}\n${cyan(line)}`);
}

let stepNo = 0;
export async function step(heading, why) {
  stepNo += 1;
  await pause();
  console.log(`\n${bold(yellow(`▶ Step ${stepNo}: ${heading}`))}`);
  if (why) console.log(dim(`  ${why}`));
}

export const say = (text) => console.log(`  ${text}`);
export const ok = (cond, text) => console.log(`  ${cond ? green('✔') : red('✖')} ${text}`);
export const show = (label, value) => console.log(`  ${dim(label.padEnd(22))} ${value}`);
export const before = (text) => console.log(`  ${red('BEFORE')}  ${text}`);
export const after = (text) => console.log(`  ${green('AFTER ')}  ${text}`);

export function table(rows) {
  const widths = rows[0].map((_, i) => Math.max(...rows.map((r) => String(r[i]).length)));
  rows.forEach((r, n) => {
    console.log('  ' + r.map((cell, i) => String(cell).padEnd(widths[i])).join('  │  '));
    if (n === 0) console.log('  ' + widths.map((w) => '─'.repeat(w)).join('──┼──'));
  });
}

let rl;
export async function pause(text = 'Press Enter to continue') {
  if (AUTO) return;
  rl ??= createInterface({ input: process.stdin, output: process.stdout });
  await rl.question(dim(`\n  ⏎ ${text}...`));
}
export async function confirm(question) {
  if (AUTO) return true;
  rl ??= createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(`\n  ${bold('?')} ${question} [Y/n] `);
  return !/^n/i.test(answer.trim());
}
export function close() {
  rl?.close();
}

// ─── HTTP ───
export async function api(method, path, { token, body, headers = {} } = {}, retried = false) {
  const started = performance.now();
  let res;
  try {
    res = await fetch(`${API}${path}`, {
      method,
      headers: { ...headers, ...(token && { Authorization: `Bearer ${token}` }), ...(body !== undefined && { 'Content-Type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (err) {
    // A kept-alive connection to a gateway that was just restarted (load test) is dead:
    // wait for the gateway and try once more on a fresh connection.
    if (retried) throw err;
    await waitApi(30);
    return api(method, path, { token, body, headers }, true);
  }
  const text = await res.text();
  let parsed = text;
  try {
    parsed = text ? JSON.parse(text) : undefined;
  } catch {}
  return { status: res.status, body: parsed, headers: res.headers, bytes: Buffer.byteLength(text), ms: Math.round(performance.now() - started) };
}

export async function login(email, password) {
  const res = await api('POST', '/auth/login', { body: { email, password } });
  if (res.status !== 200) {
    throw new Error(`Login ${email} failed (${res.status}: ${res.body?.message}). If it is 429, wait one minute and run again.`);
  }
  return { token: res.body.accessToken, user: res.body.user };
}

export const ACCOUNTS = {
  admin: ['admin@shop.local', 'Admin@12345'],
  ahmad: ['ahmad@shop.local', 'Customer@123'],
  sara: ['sara@shop.local', 'Customer@123'],
};

/** One-line summary of an HTTP answer: "403 Forbidden · You do not have access…" */
export const answer = (r) => {
  const color = r.status < 300 ? green : r.status === 304 ? cyan : red;
  const msg = typeof r.body === 'object' && r.body?.message ? ` · ${Array.isArray(r.body.message) ? r.body.message[0] : r.body.message}` : '';
  return `${color(r.status)}${msg}`;
};

// ─── Docker / database ───
export function compose(args, env = {}, { quiet = true } = {}) {
  return execFileSync('docker', ['compose', '-f', COMPOSE, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
    stdio: quiet ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  })?.trim();
}

export function sql(db, query, host = 'postgres') {
  return compose(['exec', '-T', host, 'psql', '-U', 'app', '-d', db, '-Atc', query]);
}

export async function waitHealthy(service, seconds = 90) {
  for (let i = 0; i < seconds; i++) {
    try {
      if (compose(['ps', service, '--format', '{{.Health}}']) === 'healthy') return true;
    } catch {}
    await sleep(1000);
  }
  return false;
}

export async function waitApi(seconds = 60) {
  for (let i = 0; i < seconds; i++) {
    try {
      if ((await fetch(`${API}/health`)).ok) return true;
    } catch {}
    await sleep(1000);
  }
  return false;
}

/**
 * Makes sure the system is in its normal state before a demo: API reachable, every
 * service up, inventory at normal speed. Fixes inventory if a previous demo left it
 * stopped or slow.
 */
export async function preflight() {
  if (!(await waitApi(30))) throw new Error('The API is not reachable. Start the project: docker compose up -d');
  let slow = false;
  try {
    const inspect = execFileSync('docker', ['inspect', 'ecommerce-inventory-service-1', '--format', '{{range .Config.Env}}{{println .}}{{end}}'], { encoding: 'utf8' });
    slow = /SIMULATE_LATENCY_MS=(?!0\b)\d+/.test(inspect);
  } catch {}
  const health = (await fetch(`${API}/health`).then((r) => r.json()).catch(() => ({ services: {} }))).services;
  const down = Object.entries(health).filter(([, s]) => s.status !== 'up').map(([n]) => n);
  if (slow || down.includes('inventory')) {
    console.log(yellow('  inventory-service was left slow or stopped by an earlier demo: putting it back to normal...'));
    compose(['up', '-d', 'inventory-service'], { INVENTORY_LATENCY_MS: '0' });
    await waitHealthy('inventory-service');
  }
  const others = down.filter((n) => n !== 'inventory');
  if (others.length) throw new Error(`These services are down: ${others.join(', ')}. Run: docker compose up -d`);
}

/** Runs another script in backend/ and shows its output live. */
export function runScript(file, args = [], env = {}) {
  execFileSync(process.execPath, [join(BACKEND, file), ...args], { stdio: 'inherit', cwd: BACKEND, env: { ...process.env, ...env } });
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Runs `main`, always runs `restore` (also on Ctrl+C), and reports errors plainly. */
export async function run(main, restore = async () => {}) {
  let restoring = false;
  const doRestore = async () => {
    if (restoring) return;
    restoring = true;
    try {
      await restore();
    } catch (err) {
      console.log(red(`  Could not restore everything: ${err.message}`));
    }
  };
  process.on('SIGINT', async () => {
    console.log(yellow('\n\n  Stopped. Putting everything back to normal...'));
    await doRestore();
    process.exit(130);
  });
  try {
    await main();
  } catch (err) {
    console.log(red(`\n  ✖ ${err.message}`));
    process.exitCode = 1;
  } finally {
    await doRestore();
    close();
  }
}
