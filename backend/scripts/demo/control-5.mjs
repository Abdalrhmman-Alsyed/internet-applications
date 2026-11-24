import { execFile, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const backend = new URL('../../', import.meta.url);
const root = new URL('../../../', import.meta.url);
const port = 4005;
const composeFiles = ['compose', '-p', 'ecommerce-req5', '-f', 'docker-compose.yml', '-f', 'docker-compose.demo.yml'];
const env = {
  ...process.env,
  COMPOSE_PROJECT_NAME: 'ecommerce-req5',
  REQ5_COMPOSE_OVERRIDE: fileURLToPath(new URL('docker-compose.demo.yml', root)),
  API_URL: 'http://localhost:13000/api/v1',
  WS_URL: 'http://localhost:13000',
  MAILPIT_URL: 'http://localhost:18025',
  RABBITMQ_URL: 'amqp://app:app_password@localhost:25672',
};
const origin = `http://localhost:${port}`;
const names = ['api-gateway', 'notifications-service', 'email-worker', 'load-balancer', 'redis', 'rabbitmq', 'postgres', 'inventory-service'];
const jobs = new Map([
  ['full', { demo: [], login: true, load: true }],
  ['load', { demo: ['--load-only'], load: true }],
  ['workers', { demo: ['--workers-only'], login: true }],
  ['socket', { demo: ['--socket-only'], login: true }],
  ['rate', { demo: ['--rate-only'], login: true }],
  ['regression', { login: true }],
  ['probe', {}],
  ['start', {}],
]);
const assets = new Map([
  ['/', ['index.html', 'text/html']],
  ['/dashboard.css', ['dashboard.css', 'text/css']],
  ['/dashboard.js', ['dashboard.js', 'text/javascript']],
]);

let current = null;
let loginReadyAt = 0;
let loadReadyAt = 0;
let snapshot = { containers: [], online: false, docker: null, checkedAt: 0 };
let checking;
let lastDockerAt = 0;
const proofs = {};
const tracked = new Map([
  ['load-start', 'load'], ['load-progress', 'load'], ['load-result', 'load'],
  ['worker-count', 'workers'], ['live-order', 'live'], ['duplicate-result', 'mail'],
  ['socket-result', 'socket'], ['rate-result', 'rate'],
  ['regression-result', 'regression'], ['probe-progress', 'probe'],
]);

async function syncState() {
  const [docker, api] = await Promise.allSettled([
    exec('docker', ['ps', '-a', '--filter', 'label=com.docker.compose.project=ecommerce-req5',
      '--format', '{{.ID}} {{.Names}} {{.Label "com.docker.compose.service"}} {{.State}}'],
    { cwd: root, timeout: 8500, windowsHide: true }),
    fetch(`${env.API_URL}/health/live`, { signal: AbortSignal.timeout(2000) }),
  ]);
  let containers = snapshot.containers;
  if (docker.status === 'fulfilled') {
    containers = docker.value.stdout.trim().split(/\r?\n/).filter(Boolean).map((line) => {
      const [instance, name, service, state] = line.split(' ');
      return { instance, slot: Number(name.split('-').at(-1)), service, state };
    }).filter(({ service }) => names.includes(service));
    lastDockerAt = Date.now();
  }
  const reachable = Date.now() - lastDockerAt < 18_000;
  snapshot = {
    containers: reachable ? containers : [],
    online: api.status === 'fulfilled' && api.value.ok,
    docker: reachable,
    checkedAt: Date.now(),
  };
}

async function state() {
  if (Date.now() - snapshot.checkedAt > 1300) {
    checking ??= syncState().catch(console.error).finally(() => { checking = undefined; });
    if (!snapshot.checkedAt) await checking;
  }
  return { ...snapshot, run: current, loginReadyAt, loadReadyAt, proofs };
}

function emit(event) {
  if (event.type === 'rate-result') loginReadyAt = Date.now() + 61_000;
  if (event.type === 'load-result') loadReadyAt = Date.now() + 61_000;
  if (tracked.has(event.type)) proofs[tracked.get(event.type)] = event;
  current.events.push({ at: Date.now(), ...event });
}

function child(command, args, onLine = () => {}) {
  return new Promise((resolve, reject) => {
    const childProcess = spawn(command, args, { cwd: backend, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    const lines = createInterface({ input: childProcess.stdout });
    let details = '';
    lines.on('line', onLine);
    childProcess.stderr.on('data', (buf) => { details = (details + buf.toString()).slice(-2600); });
    childProcess.once('error', reject);
    childProcess.once('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(details.replace(/\u001b\[[0-9;]*m/g, '') || `Process exited with status ${code}`));
    });
  });
}

async function probe() {
  const counts = {};
  for (let i = 0; i < 9; i++) {
    const reply = await fetch(`${env.API_URL}/health/live`, { signal: AbortSignal.timeout(2000) });
    const instance = reply.headers.get('x-served-by');
    await reply.arrayBuffer();
    if (!reply.ok || !instance) throw new Error('The Gateway did not return a replica identifier');
    counts[instance] = (counts[instance] ?? 0) + 1;
    emit({ type: 'probe-progress', counts, sent: i + 1 });
    await new Promise((resolve) => setTimeout(resolve, 140));
  }
  emit({ type: 'probe-result', replicas: Object.keys(counts).length });
}

async function execute(name, job) {
  if (job.demo) {
    await child(process.execPath, ['scripts/demo/demo-5.mjs', '--isolated', '--dashboard', ...job.demo], (line) => {
      if (line.startsWith('DEMO5 ')) emit(JSON.parse(line.slice(6)));
    });
    return;
  }
  if (name === 'probe') {
    await probe();
    return;
  }
  if (name === 'start') {
    await exec('docker', [...composeFiles, 'up', '-d', '--no-build'], { cwd: root, timeout: 120_000, windowsHide: true });
    for (let attempt = 0; attempt < 20; attempt++) {
      await syncState();
      if (snapshot.online) return;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    throw new Error('The Gateway did not become ready after starting the isolated services');
  }
  await child(process.execPath, ['node_modules/jest/bin/jest.js', '--config', 'test/jest-e2e.json', '--runInBand', '--json'], (line) => {
    if (!line.startsWith('{"numFailedTestSuites"')) return;
    const result = JSON.parse(line);
    emit({ type: 'regression-result', passed: result.numPassedTests, total: result.numTotalTests });
  });
}

function start(name, job) {
  current = { id: randomUUID(), name, status: 'running', startedAt: Date.now(), events: [] };
  emit({ type: 'start', name });
  execute(name, job).then(() => {
    current.status = 'passed';
    emit({ type: 'finish' });
  }, (err) => {
    current.status = 'failed';
    emit({ type: 'error', text: err.message.slice(-1800) });
  }).finally(() => {
    if (name === 'regression') loginReadyAt = Date.now() + 61_000;
    current.finishedAt = Date.now();
  });
}

function reply(res, code, value, type = 'application/json') {
  res.writeHead(code, {
    'Content-Type': `${type}; charset=utf-8`,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'none'",
  });
  res.end(type === 'application/json' ? JSON.stringify(value) : value);
}

const server = createServer(async (req, res) => {
  const host = req.headers.host;
  if (host !== `localhost:${port}` && host !== `127.0.0.1:${port}`) {
    reply(res, 403, { error: 'لوحة العرض تقبل الاتصالات المحلية فقط.' });
    return;
  }
  try {
    if (req.method === 'GET' && assets.has(req.url)) {
      const [file, type] = assets.get(req.url);
      const page = await readFile(new URL(`./control-5/${file}`, import.meta.url));
      reply(res, 200, page, type);
      return;
    }
    if (req.method === 'GET' && req.url === '/api/state') {
      reply(res, 200, await state());
      return;
    }
    const action = /^\/api\/run\/([a-z]+)$/.exec(req.url ?? '')?.[1];
    if (req.method !== 'POST' || !jobs.has(action)) {
      reply(res, 404, { error: 'المسار غير موجود.' });
      return;
    }
    if (req.headers.origin !== `http://${host}` || req.headers['x-demo-action'] !== '1') {
      reply(res, 403, { error: 'شغّل التجربة من لوحة العرض المحلية.' });
      return;
    }
    const job = jobs.get(action);
    if (current?.status === 'running' || (job.login && loginReadyAt > Date.now()) || (job.load && loadReadyAt > Date.now())) {
      reply(res, 409, { error: 'انتظر انتهاء التجربة أو تجديد نافذة حدّ الطلبات.' });
      return;
    }
    const readiness = await state();
    if (!readiness.docker || (!readiness.online && action !== 'start')) {
      reply(res, 409, { error: 'تأكد من تشغيل Docker وخدمات النسخة المعزولة.' });
      return;
    }
    if (current?.status === 'running') {
      reply(res, 409, { error: 'في تجربة قيد التشغيل.' });
      return;
    }
    start(action, job);
    reply(res, 202, { id: current.id });
  } catch (err) {
    console.error(err);
    reply(res, 500, { error: 'تعذّر تنفيذ الطلب. افحص نافذة تشغيل لوحة العرض.' });
  }
});

server.listen(port, '127.0.0.1', () => console.log(`لوحة عرض المتطلب الخامس: ${origin}`));
