// Requirement 4: a local "remote control" page for the live demo (scenes 6, 7 and 8).
//   npm run control:4   →   http://localhost:3999
//
// It is a presentation tool, not part of the shop: each button runs one docker / RabbitMQ
// action (stop the worker, stop the mail server, send a broken message…) and the page shows
// the queues, the containers and the worker's log live. It listens on 127.0.0.1 only.
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { promisify } from 'node:util';
import * as amqp from 'amqplib';
import { BACKEND } from './lib.mjs';

const run = promisify(execFile);
const PORT = Number(process.env.CONTROL_PORT ?? 3999);
const COMPOSE = join(BACKEND, '..', 'docker-compose.yml');
const RABBIT = process.env.RABBITMQ_URL ?? 'amqp://app:app_password@localhost:5672';
const MAILPIT = 'http://localhost:8025';
const QUEUES = ['email.order-created', 'email.retry', 'email.dead', 'notifications.events'];

const compose = (...args) => run('docker', ['compose', '-f', COMPOSE, ...args], { timeout: 60000 }).then((r) => r.stdout.trim());

// ─── RabbitMQ (own connection: exact counts, no 5-second stats delay) ───
let ch = null;
async function channel() {
  if (ch) return ch;
  const conn = await amqp.connect(RABBIT);
  conn.on('error', () => undefined);
  conn.on('close', () => (ch = null));
  ch = await conn.createChannel();
  ch.on('error', () => (ch = null));
  ch.on('close', () => (ch = null));
  return ch;
}

async function state() {
  const out = { containers: {}, queues: {}, logs: [], mails: null, error: null };
  try {
    const s = await run('docker', ['inspect', '-f', '{{.Name}} {{.State.Status}}', 'ecommerce-email-worker-1', 'ecommerce-mailpit-1'], { timeout: 5000 });
    for (const line of s.stdout.trim().split('\n')) {
      const [name, status] = line.trim().split(' ');
      out.containers[name.replace(/^\/ecommerce-|-1$/g, '')] = status;
    }
  } catch {
    out.error = 'Docker is not reachable';
  }
  try {
    const c = await channel();
    for (const q of QUEUES) {
      const r = await c.checkQueue(q);
      out.queues[q] = { waiting: r.messageCount, consumers: r.consumerCount };
    }
  } catch {
    ch = null;
    out.error ??= 'RabbitMQ is not reachable';
  }
  try {
    const logs = await compose('logs', '--no-log-prefix', '--tail', '40', 'email-worker');
    out.logs = logs
      .split('\n')
      .map((l) => l.replace(/\x1b\[[0-9;]*m/g, ''))
      .filter((l) => l.includes('[EmailWorker]'))
      .map((l) => {
        const time = l.match(/(\d{1,2}:\d{2}:\d{2} [AP]M)/)?.[1] ?? '';
        const level = /ERROR/.test(l) ? 'error' : /WARN/.test(l) ? 'warn' : 'log';
        return { time, level, text: l.replace(/^.*\[EmailWorker\] /, '') };
      })
      .slice(-9);
  } catch {}
  try {
    out.mails = (await fetch(`${MAILPIT}/api/v1/messages?limit=1`, { signal: AbortSignal.timeout(1500) }).then((r) => r.json())).total ?? null;
  } catch {}
  return out;
}

const ACTIONS = {
  'stop-worker': async () => (await compose('stop', 'email-worker'), 'email-worker stopped'),
  'start-worker': async () => (await compose('up', '-d', 'email-worker'), 'email-worker started (normal settings)'),
  'stop-mail': async () => (await compose('stop', 'mailpit'), 'Mail server (Mailpit) stopped'),
  'start-mail': async () => (await compose('start', 'mailpit'), 'Mail server (Mailpit) started'),
  'publish-bad': async () => {
    const c = await channel();
    c.sendToQueue('email.order-created', Buffer.from('hello (a message nobody can read)'), { persistent: true });
    return 'A broken message was put on email.order-created';
  },
  'get-dead': async () => {
    const c = await channel();
    const m = await c.get('email.dead', { noAck: false });
    if (!m) return { text: 'email.dead is empty' };
    const h = m.properties.headers ?? {};
    const death = h['x-death']?.[0] ?? {};
    c.nack(m, false, true); // look only: leave it in the queue
    return {
      text: 'First message in email.dead (left in the queue)',
      message: {
        payload: m.content.toString().slice(0, 200),
        'x-death.reason': death.reason,
        'x-death.queue': death.queue,
        'x-death.count': death.count,
        'x-attempt': h['x-attempt'] ?? 1,
        'x-last-error': h['x-last-error'] ?? '(could not be read, so it was not retried)',
      },
    };
  },
  'purge-dead': async () => {
    const c = await channel();
    const r = await c.purgeQueue('email.dead');
    return `email.dead emptied (${r.messageCount} removed)`;
  },
  reset: async () => {
    await compose('up', '-d', 'email-worker', 'mailpit');
    return 'Everything back to normal: worker and mail server running';
  },
};

const server = createServer(async (req, res) => {
  const send = (code, body, type = 'application/json') => {
    res.writeHead(code, { 'Content-Type': `${type}; charset=utf-8`, 'Cache-Control': 'no-store' });
    res.end(type === 'application/json' ? JSON.stringify(body) : body);
  };
  try {
    if (req.method === 'GET' && req.url === '/') return send(200, PAGE, 'text/html');
    if (req.method === 'GET' && req.url === '/api/state') return send(200, await state());
    const m = req.url?.match(/^\/api\/action\/([a-z-]+)$/);
    if (req.method === 'POST' && m && ACTIONS[m[1]]) {
      const r = await ACTIONS[m[1]]();
      return send(200, typeof r === 'string' ? { text: r } : r);
    }
    send(404, { text: 'Not found' });
  } catch (err) {
    send(500, { text: `Failed: ${err.message}` });
  }
});
server.listen(PORT, '127.0.0.1', () => console.log(`Demo control page: http://localhost:${PORT}`));

// ─── The page ───
const PAGE = /* html */ `<!doctype html>
<html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Demo control · Requirement 4</title>
<style>
:root{--ink:#15232b;--muted:#5b6b73;--line:#dbe3e7;--soft:#f3f6f7;--acc:#0b6377;--accs:#e1eff2;--ok:#1d6e3a;--oks:#e3f2e8;--bad:#a4372b;--bads:#f8e7e4;--warn:#9a5b00;--warns:#fbefdc}
*{box-sizing:border-box}body{margin:0;font-family:"Segoe UI",Tahoma,sans-serif;background:#f6f8f9;color:var(--ink);font-size:14px}
header{background:#10202a;color:#fff;padding:10px 16px;display:flex;align-items:center;justify-content:space-between;gap:10px}
header b{font-size:16px}header small{color:#9fb6bf}
.wrap{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(0,1fr);gap:14px;padding:14px;max-width:1200px;margin:0 auto}
@media(max-width:820px){.wrap{grid-template-columns:1fr}}
.card{background:#fff;border:1px solid var(--line);border-radius:12px;padding:12px 14px}
.tabs{display:flex;gap:6px;margin-bottom:10px}
.tab{flex:1;border:1px solid var(--line);background:#fff;border-radius:10px;padding:8px;cursor:pointer;font-weight:600;font-size:13px;color:var(--muted)}
.tab.on{background:var(--acc);color:#fff;border-color:var(--acc)}
.scene{display:none}.scene.on{display:block}
.scene h2{margin:0 0 4px;font-size:17px}.scene p.lead{margin:0 0 10px;color:var(--muted)}
.step{display:grid;grid-template-columns:30px 1fr;gap:10px;align-items:start;padding:9px 0;border-top:1px dashed var(--line)}
.n{width:28px;height:28px;border-radius:50%;background:var(--soft);color:var(--muted);display:flex;align-items:center;justify-content:center;font-weight:700}
.step.next .n{background:var(--acc);color:#fff}.step.done .n{background:var(--ok);color:#fff}
.step .t{font-weight:600}.step .h{color:var(--muted);font-size:12.5px;margin-top:2px}
.say{background:var(--accs);border-radius:8px;padding:6px 10px;margin-top:6px;font-size:12.5px;color:#1f4652}
button.act{margin-top:6px;border:0;border-radius:9px;padding:9px 14px;font-weight:700;font-size:14px;cursor:pointer;background:var(--acc);color:#fff}
button.act.red{background:var(--bad)}button.act.green{background:var(--ok)}button.act.gray{background:#5b6b73}
button.act:disabled{opacity:.5;cursor:wait}
.manual{display:inline-block;margin-top:6px;background:var(--warns);color:var(--warn);border-radius:8px;padding:5px 10px;font-weight:600;font-size:12.5px}
h3{margin:0 0 8px;font-size:14px}
table{width:100%;border-collapse:collapse;font-size:13px}td,th{padding:5px 6px;border-bottom:1px solid var(--line);text-align:start}
td.num{font-weight:700;font-size:16px;direction:ltr;text-align:center;width:70px}
.hl{background:#fff4cf;transition:background .6s}
.pill{display:inline-block;border-radius:20px;padding:2px 10px;font-weight:700;font-size:12px}
.pill.running{background:var(--oks);color:var(--ok)}.pill.exited,.pill.missing{background:var(--bads);color:var(--bad)}.pill.other{background:var(--soft);color:var(--muted)}
.logs{direction:ltr;text-align:left;background:#10202a;color:#d8e6ea;font-family:Consolas,monospace;font-size:11.5px;border-radius:8px;padding:8px 10px;min-height:150px;line-height:1.55}
.logs .warn{color:#f3c969}.logs .error{color:#f09080}.logs .log{color:#9be3b4}.logs i{color:#7f9aa4;font-style:normal}
.toast{position:fixed;bottom:14px;left:14px;background:#10202a;color:#fff;border-radius:10px;padding:10px 14px;max-width:460px;opacity:0;transition:opacity .3s;direction:ltr;text-align:left;font-size:13px}
.toast.on{opacity:1}
pre.msg{direction:ltr;text-align:left;background:var(--soft);border-radius:8px;padding:8px 10px;font-size:12px;white-space:pre-wrap;margin:8px 0 0}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px}
.kv{border:1px solid var(--line);border-radius:10px;padding:8px 10px}.kv small{color:var(--muted)}
</style></head><body>
<header><div><b>🎛️ Demo control · Requirement 4</b><br><small>Presentation remote: every button runs one docker / RabbitMQ action. Not part of the shop.</small></div>
<button class="act gray" onclick="act('reset',this)">↺ Reset to normal</button></header>
<div class="wrap">
<div class="card">
  <div class="tabs">
    <button class="tab on" data-s="6">6 · وقّف العامل</button>
    <button class="tab" data-s="7">7 · سيرفر البريد وقع</button>
    <button class="tab" data-s="8">8 · رسالة خربانة (DLQ)</button>
  </div>

  <section class="scene on" id="s6">
    <h2>ولا إيميل بيضيع لو العامل وقف</h2>
    <p class="lead">بنوقّف email-worker، بنعمل طلبات، بنشوف الرسائل مستنية، بنشغّلو، بتوصل الإيميلات.</p>
    <div class="step"><div class="n">1</div><div><div class="t">وقّف العامل</div>
      <button class="act red" onclick="act('stop-worker',this)">■ Stop email-worker</button>
      <div class="h">بالجدول: email-worker صار <b>exited</b>، و consumers لـ email.order-created صار 0.</div></div></div>
    <div class="step"><div class="n">2</div><div><div class="t">بنافذة أحمد: Place a test order (مرتين)</div>
      <span class="manual">👉 بالنافذة اليمين</span>
      <div class="h">الطلبات بتطلع عند الأدمن فوراً. وهون: email.order-created waiting = <b>2</b>، والإيميلات بـ Mailpit ما زادت.</div>
      <div class="say">"العامل واقف، بس الطلبات شغّالة. الإيميلين مستنيين بالطابور: 2 رسائل، 0 عمّال."</div></div></div>
    <div class="step"><div class="n">3</div><div><div class="t">شغّل العامل</div>
      <button class="act green" onclick="act('start-worker',this)">▶ Start email-worker</button>
      <div class="h">waiting بيرجع 0، وباللوغ "confirmation sent" مرتين، و Mailpit زاد 2.</div>
      <div class="say">"وصلوا الاتنين. ما ضاع شي: الطابور durable، والرسائل persistent، والـ ack بعد الإرسال بس."</div></div></div>
  </section>

  <section class="scene" id="s7">
    <h2>إعادة المحاولة لما البريد واقف</h2>
    <p class="lead">بنوقّف سيرفر البريد. العامل بيفشل، بيحط الرسالة بطابور انتظار، وبيرجع يجرب.</p>
    <div class="step"><div class="n">1</div><div><div class="t">وقّف سيرفر البريد</div>
      <button class="act red" onclick="act('stop-mail',this)">■ Stop mail server</button>
      <div class="h">mailpit صار <b>exited</b>.</div></div></div>
    <div class="step"><div class="n">2</div><div><div class="t">بنافذة أحمد: Place a test order (مرة وحدة)</div>
      <span class="manual">👉 بالنافذة اليمين</span>
      <div class="h">استنى حوالي 10 ثواني: باللوغ بالأصفر <b>attempt 1/4 failed … Retrying in 5000 ms</b>.</div>
      <div class="say">"المحاولة فشلت. العامل ما رمى الرسالة ولا رجّعها فوراً: حطها بـ email.retry تستنى 5 ثواني، بعدين 30، بعدين دقيقتين."</div></div></div>
    <div class="step"><div class="n">3</div><div><div class="t">رجّع سيرفر البريد</div>
      <button class="act green" onclick="act('start-mail',this)">▶ Start mail server</button>
      <div class="h">خلال ثواني (أو لحد 30 ثانية): باللوغ بالأخضر <b>confirmation sent … (attempt 2)</b>.</div>
      <div class="say">"رجع البريد، والمحاولة التانية نجحت. ولا إيميل ضاع."</div></div></div>
  </section>

  <section class="scene" id="s8">
    <h2>الـ DLQ: رسالة ما بتنقرا</h2>
    <p class="lead">بنبعت رسالة خربانة للطابور. العامل بيرفضها، و RabbitMQ بنفسو بينقلها عبر الـ Dead Letter Exchange لـ email.dead.</p>
    <div class="step"><div class="n">1</div><div><div class="t">ابعت رسالة خربانة</div>
      <button class="act red" onclick="act('publish-bad',this)">✉ Send a broken message</button>
      <div class="h">باللوغ بالأحمر <b>Unreadable message, sending it to the dead-letter queue</b>، و email.dead صار <b>1</b>.</div></div></div>
    <div class="step"><div class="n">2</div><div><div class="t">فرجي الرسالة الميتة وسببها</div>
      <button class="act" onclick="act('get-dead',this)">🔍 Show the dead message</button>
      <div class="h">بيطلع x-death.reason = <b>rejected</b> و x-death.queue = email.order-created.</div>
      <div class="say">"الرسالة ما ضاعت وما علّقت غيرها. RabbitMQ حطها بـ email.dead وكتب السبب. ونفس الشي لأي رسالة بتفشل 4 مرات."</div>
      <div id="dead"></div></div></div>
    <div class="step"><div class="n">3</div><div><div class="t">نضّف بعد العرض (اختياري)</div>
      <button class="act gray" onclick="act('purge-dead',this)">🗑 Empty email.dead</button></div></div>
  </section>
</div>

<div>
  <div class="card" style="margin-bottom:14px">
    <h3>الحاويات</h3>
    <div class="grid2">
      <div class="kv"><small>email-worker</small><br><span id="c-email-worker" class="pill other">…</span></div>
      <div class="kv"><small>mailpit (سيرفر البريد)</small><br><span id="c-mailpit" class="pill other">…</span></div>
    </div>
    <h3>الطوابير (لحظي)</h3>
    <table><thead><tr><th>Queue</th><th style="text-align:center">waiting</th><th style="text-align:center">consumers</th></tr></thead><tbody id="queues"></tbody></table>
    <div style="margin-top:8px;color:var(--muted)">📧 إيميلات بـ Mailpit: <b id="mails" style="color:var(--ink);font-size:16px">…</b></div>
  </div>
  <div class="card"><h3>لوغ email-worker (لحظي)</h3><div class="logs" id="logs">…</div></div>
</div>
</div>
<div class="toast" id="toast"></div>
<script>
const tabs = document.querySelectorAll('.tab');
function show(n){ tabs.forEach(t=>t.classList.toggle('on', t.dataset.s===n)); document.querySelectorAll('.scene').forEach(s=>s.classList.toggle('on', s.id==='s'+n)); try{localStorage.setItem('scene',n)}catch{} }
tabs.forEach(t=>t.onclick=()=>show(t.dataset.s));
try{ const s=localStorage.getItem('scene'); if(s) show(s) }catch{}
let toastT;
function toast(text){ const el=document.getElementById('toast'); el.textContent=text; el.classList.add('on'); clearTimeout(toastT); toastT=setTimeout(()=>el.classList.remove('on'),3500); }
async function act(name, btn){
  btn.disabled = true;
  try{
    const r = await fetch('/api/action/'+name,{method:'POST'}).then(r=>r.json());
    toast(r.text);
    const step = btn.closest('.step'); if(step){ step.classList.add('done'); }
    if(name==='get-dead') document.getElementById('dead').innerHTML = r.message ? '<pre class="msg">'+Object.entries(r.message).map(([k,v])=>k.padEnd(16)+' '+v).join('\\n')+'</pre>' : '<pre class="msg">'+r.text+'</pre>';
    if(name==='purge-dead') document.getElementById('dead').innerHTML='';
    if(name==='reset') document.querySelectorAll('.step').forEach(s=>s.classList.remove('done'));
    refresh();
  } finally { btn.disabled = false; }
}
let last = {};
async function refresh(){
  try{
    const s = await fetch('/api/state').then(r=>r.json());
    for (const k of ['email-worker','mailpit']){ const el=document.getElementById('c-'+k); const v=s.containers[k]??'missing'; el.textContent=v; el.className='pill '+(v==='running'?'running':(v==='exited'?'exited':'other')); }
    document.getElementById('queues').innerHTML = Object.entries(s.queues).map(([q,v])=>{
      const changed = last[q] && last[q].waiting!==v.waiting;
      return '<tr class="'+(changed?'hl':'')+'"><td style="direction:ltr;text-align:left;font-family:Consolas,monospace">'+q+'</td><td class="num" style="color:'+(q==='email.dead'&&v.waiting?'var(--bad)':'inherit')+'">'+v.waiting+'</td><td class="num">'+v.consumers+'</td></tr>';
    }).join('') || '<tr><td colspan=3>'+(s.error||'')+'</td></tr>';
    last = s.queues;
    document.getElementById('mails').textContent = s.mails ?? '(mail server down)';
    document.getElementById('logs').innerHTML = s.logs.length ? s.logs.map(l=>'<div class="'+l.level+'"><i>'+l.time+'</i>  '+l.text.replace(/</g,'&lt;')+'</div>').join('') : (s.containers['email-worker']==='running'?'…':'(worker stopped: no new lines)');
  }catch{}
}
refresh(); setInterval(refresh, 1500);
</script></body></html>`;
