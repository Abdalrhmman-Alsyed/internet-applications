const labels = {
  full: 'العرض الكامل',
  load: 'اختبار 500 طلب',
  workers: 'البريد والبث اللحظي',
  socket: 'إعادة اتصال WebSocket',
  rate: 'الحدّ المشترك لتسجيل الدخول',
  regression: 'اختبارات النظام السابقة',
  probe: 'فحص 9 طلبات',
  start: 'تشغيل الخدمات المعزولة',
};
const stages = {
  load: 'عم نجهّز اختبار توزيع الطلبات.',
  workers: 'عم نفحص الطابور ونجهّز طلباً تجريبياً.',
  socket: 'عم نفتح اتصال WebSocket بقناة الأدمن.',
  rate: 'عم نوزّع محاولات الدخول على النسخ الثلاث.',
};
const phases = { before: 'قبل الإيقاف · النسخ الثلاث شغّالة', stopping: 'عم نوقّف نسخة أثناء إرسال الطلبات', after: 'بعد الإيقاف · النسختان الباقيتان عم يردّوا' };
const phaseKeys = Object.keys(phases);
const $ = (selector) => document.querySelector(selector);
const write = (selector, value) => { $(selector).textContent = value; };
const actionButtons = [...document.querySelectorAll('[data-run]')];
const loginActions = new Set(['full', 'rate', 'workers', 'socket', 'regression']);
const loadActions = new Set(['full', 'load']);
const clock = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const number = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 });
let snapshot;
let posting = false;
let message = '';
let lastTimeline = '';

function makeReplica(slot) {
  const replica = document.createElement('div');
  replica.className = 'replica';
  replica.innerHTML = `
    <div class="replica-wire" aria-hidden="true"><i></i></div>
    <div class="replica-tile">
      <strong class="replica-name">النسخة ${slot}</strong>
      <span class="replica-info"><i class="dot"></i><span>بانتظار الفحص</span></span>
      <span class="replica-count">—</span>
    </div>`;
  $('#replicas').append(replica);
  const row = document.createElement('div');
  row.className = 'chart-row';
  row.innerHTML = `
    <span class="chart-name">النسخة ${slot}</span>
    <div class="chart-track" role="img" aria-label="بانتظار الاختبار">
      <span class="before"></span><span class="stopping"></span><span class="after"></span>
    </div><div class="chart-numbers" aria-hidden="true"><b class="before">—</b><b class="stopping">—</b><b class="after">—</b></div>`;
  $('#chart').append(row);
  return { slot, replica, row };
}
const replicas = [1, 2, 3].map(makeReplica);

function renderControls() {
  const remaining = (until) => Math.max(0, Math.ceil(((until ?? 0) - Date.now()) / 1000));
  const loginSeconds = remaining(snapshot?.loginReadyAt);
  const loadSeconds = remaining(snapshot?.loadReadyAt);
  const running = snapshot?.run?.status === 'running';
  for (const button of actionButtons) {
    const action = button.dataset.run;
    const ready = snapshot?.docker && (action === 'start' || snapshot?.online);
    const wait = Math.max(loginActions.has(action) ? loginSeconds : 0, loadActions.has(action) ? loadSeconds : 0);
    button.disabled = Boolean(posting || running || !ready || wait);
    button.title = wait ? `جاهز للتكرار خلال ${wait} ثانية` : '';
  }
  $("[data-run='start']").hidden = snapshot?.online || !snapshot?.docker;
  let hint = '';
  if (snapshot?.docker === false) hint = 'شغّل Docker Desktop حتى تظهر الحاويات وتشتغل التجارب.';
  else if (snapshot?.docker && !snapshot.online) hint = 'خدمات العرض المعزولة موقّفة. فيك تشغّلها من الزر فوق.';
  else if (!running) {
    hint = [
      loginSeconds ? `تجارب تسجيل الدخول بتتجدد خلال ${loginSeconds} ثانية.` : '',
      loadSeconds ? `اختبار الـ500 بيتجدد خلال ${loadSeconds} ثانية.` : '',
    ].filter(Boolean).join(' ');
  }
  write('#message', message || hint);
}

function renderTraffic() {
  const { proofs, containers, run } = snapshot;
  const gatewayContainers = containers.filter(({ service }) => service === 'api-gateway');
  const workerCount = containers.filter(({ service, state }) => service === 'email-worker' && state === 'running').length;
  const active = run?.status === 'running';
  const load = proofs.load;
  const probe = run?.name === 'probe' ? proofs.probe : null;
  const sent = load?.sent ?? 0;
  const failed = load?.failed ?? 0;
  const target = load?.total ?? 500;
  const victims = new Map([
    ['gateway-stopping', 'stopping'], ['gateway-stopped', 'down'], ['gateway-restored', null],
  ]);
  let victim;
  let transient;
  if (active) {
    for (const event of run.events) {
      if (victims.has(event.type)) {
        victim = event.instance;
        transient = victims.get(event.type);
      }
    }
  }

  $('#architecture').classList.toggle('moving', Boolean(active && (run.name === 'probe' || (load?.type !== 'load-result' && ['full', 'load'].includes(run.name)))));
  const probing = run?.name === 'probe' && probe;
  write('#arch-caption', probing ? `${probe.sent} / 9 طلبات فحص` : 'HAProxy · Round Robin');
  const countValues = Object.values(load?.counts ?? {}).map((result) => phaseKeys.reduce((total, phase) => total + result[phase], 0));
  const chartMax = Math.max(200, ...countValues);
  for (const { slot, replica, row } of replicas) {
    const container = gatewayContainers.find((item) => item.slot === slot);
    const instance = container?.instance;
    const stopping = active && victim === instance && transient === 'stopping';
    const down = !container || container.state !== 'running' || (active && victim === instance && transient === 'down');
    replica.classList.toggle('down', down);
    replica.classList.toggle('stopping', stopping);
    replica.querySelector('.dot').classList.toggle('ready', !down && !stopping);
    replica.querySelector('.replica-info span').textContent = stopping ? 'عم تتوقّف' : container ? (down ? 'متوقّفة' : 'شغّالة') : 'غير متاحة';
    const counts = load?.counts?.[instance];
    const total = counts ? phaseKeys.reduce((n, phase) => n + counts[phase], 0) : null;
    const shown = probing ? (probe.counts?.[instance] ?? 0) : total;
    replica.querySelector('.replica-count').textContent = shown == null ? '—' : `${shown} طلب`;
    const track = row.querySelector('.chart-track');
    const values = phaseKeys.map((phase) => counts?.[phase] ?? 0);
    [...track.children].forEach((bar, index) => bar.style.setProperty('--w', `${values[index] / chartMax * 100}%`));
    track.setAttribute('aria-label', `النسخة ${slot} · قبل ${values[0]} · أثناء ${values[1]} · بعد ${values[2]}`);
    track.title = track.getAttribute('aria-label');
    [...row.querySelector('.chart-numbers').children].forEach((label, index) => {
      label.textContent = counts ? values[index] : '—';
    });
  }
  write('#metric-sent', load ? sent : '—');
  write('#metric-success', sent ? number.format((sent - failed) * 100 / sent) : '—');
  write('#metric-failures', load ? `${failed} طلب غير ناجح` : 'بتظهر أثناء الاختبار');
  write('#metric-latency', load?.p95 ?? '—');
  write('#metric-gateways', snapshot.docker ? gatewayContainers.filter((c) => c.state === 'running' && !(active && victim === c.instance && transient === 'down')).length : '—');
  write('#metric-worker-note', snapshot.docker ? `${workerCount} عامل بريد شغّال` : 'بانتظار Docker');
  write('#progress-value', `${sent} / ${target}`);
  write('#progress-phase', (load?.type === 'load-result' ? 'اكتمل إرسال الطلبات' : phases[load?.phase]) ?? 'بانتظار تشغيل الاختبار');
  $('#progress').setAttribute('aria-valuenow', sent);
  $('#progress').style.setProperty('--position', `${sent / target * 100}%`);
}

function eventCopy(event) {
  switch (event.type) {
    case 'start': return [`بدأت تجربة ${labels[event.name]}.`];
    case 'stage': return [stages[event.name]];
    case 'gateway-stopping': return [`بلغنا 200 طلب. عم نوقّف نسخة ${event.instance}.`, 'warn'];
    case 'gateway-stopped': return ['Docker أكّد الإيقاف. الطلبات مستمرة على النسختين الباقيتين.', 'warn'];
    case 'load-result': return [`نجح ${event.sent - event.failed} من ${event.sent} طلب. p95 بلغ ${event.p95} ms.`, 'ok'];
    case 'gateway-restored': return ['رجعت النسخة المتوقفة تستقبل الطلبات.', 'ok'];
    case 'worker-count': return [`${event.count} عمّال على طابور البريد.`, event.count === 2 ? 'warn' : ''];
    case 'live-order': return [`الطلب #${event.order} ظهر على ${event.recipients} اتصالات، ووصل تأكيد واحد.`, 'ok'];
    case 'duplicate-result': return [`${event.messages} عمليات تسليم، ${event.skipped} مكررة، وإيميل واحد في Mailpit.`, 'ok'];
    case 'socket-stopping': return ['عم نوقّف النسخة اللي مستضيفة اتصال العميل.', 'warn'];
    case 'socket-result': return ['رجع اتصال العميل واشترك مجدداً بقناة الأدمن.', 'ok'];
    case 'socket-restored': return ['رجعت نسخة الإشعارات تستقبل اتصالات.', 'ok'];
    case 'rate-result': return [`ظهر HTTP ${event.status} بعد استهلاك حدّ ${event.limit} طلباً المشترك.`, 'ok'];
    case 'probe-result': return [`9 طلبات تلقّت ردود من ${event.replicas} نسخ.`, 'ok'];
    case 'regression-result': return [`نجح ${event.passed} من ${event.total} اختبار.`, event.passed === event.total ? 'ok' : 'warn'];
    case 'finish': return ['التجربة خلصت بنجاح.', 'ok'];
    case 'error': return ['التجربة تعثّرت. تفاصيل الخطأ بتساعدك تحدد السبب.', 'error', event.text];
    default: return null;
  }
}

function renderTimeline() {
  const run = snapshot.run;
  if (!run) return;
  write('#run-label', labels[run.name]);
  const status = { running: 'قيد التنفيذ', passed: 'ناجحة', failed: 'تعثّرت' };
  $('#run-status').className = `run-status ${run.status}`;
  write('#run-status', status[run.status]);
  const entries = run.events.flatMap((event) => {
    const copy = eventCopy(event);
    return copy ? [{ event, copy }] : [];
  });
  const key = `${run.id}:${entries.length}`;
  if (lastTimeline === key) return;
  lastTimeline = key;
  const list = $('#timeline');
  list.replaceChildren(...entries.map(({ event, copy: [label, tone, detail] }) => {
    const item = document.createElement('li');
    if (tone) item.className = tone;
    const message = document.createElement('span');
    message.textContent = label;
    if (detail) {
      const details = document.createElement('small');
      details.className = 'detail';
      details.textContent = detail;
      message.append(details);
    }
    const time = document.createElement('time');
    time.dir = 'ltr';
    time.textContent = clock.format(event.at);
    item.append(message, time);
    return item;
  }));
  list.scrollTop = list.scrollHeight;
}

function render() {
  const { docker, online, proofs } = snapshot;
  const tone = online && docker ? 'ready' : 'offline';
  const connectionLabel = docker ? (online ? 'متصلة بالنظام' : 'الخدمات متوقّفة') : 'Docker غير متاح';
  $('#connection').className = `connection ${tone}`;
  $('#sidebar-dot').className = `dot ${tone}`;
  write('#connection span:last-child', connectionLabel);
  write('#sidebar-state', connectionLabel);
  renderControls();
  renderTraffic();
  renderTimeline();
  if (proofs.rate) write('#proof-rate', `HTTP ${proofs.rate.status} · حدّ ${proofs.rate.limit} عبر ${proofs.rate.replicas} نسخ`);
  if (proofs.mail) write('#proof-mail', `${proofs.mail.messages} تسليمات · ${proofs.mail.emails} إيميل · ${proofs.live?.recipients ?? '—'} اتصالات`);
  if (proofs.socket) write('#proof-socket', `عاد الاشتراك في ${proofs.socket.channel}`);
  if (proofs.regression) write('#proof-regression', `${proofs.regression.passed} من ${proofs.regression.total} نجحوا`);
}

async function getState() {
  const response = await fetch('/api/state', { cache: 'no-store' });
  if (!response.ok) throw new Error('تعذّر تحديث حالة لوحة العرض.');
  snapshot = await response.json();
  render();
}

async function poll() {
  try {
    await getState();
  } catch (err) {
    write('#message', err.message);
  } finally {
    setTimeout(poll, snapshot?.run?.status === 'running' ? 390 : 1250);
  }
}

for (const button of actionButtons) {
  button.addEventListener('click', async () => {
    posting = true;
    message = '';
    renderControls();
    try {
      const response = await fetch(`/api/run/${button.dataset.run}`, { method: 'POST', headers: { 'X-Demo-Action': '1' } });
      if (!response.ok) throw new Error((await response.json()).error);
      await getState();
    } catch (err) {
      message = err.message;
    } finally {
      posting = false;
      renderControls();
    }
  });
}
for (const anchor of document.querySelectorAll('.site-nav a')) {
  anchor.addEventListener('click', () => {
    $('.site-nav a.selected')?.classList.remove('selected');
    anchor.classList.add('selected');
  });
}
renderControls();
poll();
