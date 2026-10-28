'use client';

import { Fragment, useState } from 'react';
import { Badge, Button, Card, ErrorBox, PageHeader } from '@/components/ui';
import { ApiError, getTokens, raw, shortId, type RawResponse } from '@/lib/api';
import type { Order, Paginated, Product, User } from '@/lib/types';

/**
 * Security lab: real requests against the running API, each trying to cross a
 * permission boundary. The server must reject every attack; the "controls" at
 * the end show the same resources are reachable by those who own them.
 */

const DEMO_PASSWORD = 'Customer@123';

interface Ctx {
  admin: string;
  ahmad: { token: string; user: User };
  sara: { token: string; user: User };
  saraOrderId: string;
  saraNotificationId: string | null;
  productId: string;
}

interface Scenario {
  group: string;
  title: string;
  actor: string;
  method: string;
  path: (c: Ctx) => string;
  token: (c: Ctx) => string | null;
  body?: (c: Ctx) => unknown;
  form?: () => FormData;
  expect: number;
  /** Extra check beyond the status code. */
  check?: (r: RawResponse, c: Ctx) => boolean;
  why: string;
}

const SCENARIOS: Scenario[] = [
  // ─── Authentication ───
  { group: 'Authentication', title: 'Read orders without a token', actor: 'Anonymous', method: 'GET', path: () => '/orders', token: () => null, expect: 401, why: 'Every route needs a JWT unless marked @Public().' },
  { group: 'Authentication', title: 'Use a forged token', actor: 'Attacker', method: 'GET', path: () => '/users/me', token: () => 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJoYWNrZXIiLCJyb2xlIjoiQURNSU4ifQ.forged-signature', expect: 401, why: 'The signature is verified with the server secret; a token claiming role ADMIN is rejected.' },

  // ─── Vertical escalation: customer → admin ───
  { group: 'Customer → Admin actions', title: 'Register yourself as ADMIN', actor: 'Anonymous', method: 'POST', path: () => '/auth/register', token: () => null, body: () => ({ email: `evil.${Date.now()}@test.local`, password: DEMO_PASSWORD, name: 'Evil', role: 'ADMIN' }), expect: 400, why: 'Unknown fields are rejected (forbidNonWhitelisted); sign-ups are always CUSTOMER.' },
  { group: 'Customer → Admin actions', title: 'Create a product', actor: 'Ahmad (customer)', method: 'POST', path: () => '/products', token: (c) => c.ahmad.token, body: () => ({ name: 'Hacked product', price: 1, stock: 999 }), expect: 403, why: '@Roles(ADMIN) on the gateway route.' },
  { group: 'Customer → Admin actions', title: 'Upload a product image', actor: 'Ahmad (customer)', method: 'POST', path: (c) => `/products/${c.productId}/images`, token: (c) => c.ahmad.token, form: () => pngForm(), expect: 403, why: '@Roles(ADMIN) runs before the file is processed.' },
  { group: 'Customer → Admin actions', title: 'Change an order status to DELIVERED', actor: 'Ahmad (customer)', method: 'PATCH', path: (c) => `/orders/${c.saraOrderId}/status`, token: (c) => c.ahmad.token, body: () => ({ status: 'DELIVERED' }), expect: 403, why: 'Gateway role guard, and orders-service checks the role again.' },
  { group: 'Customer → Admin actions', title: 'List all users', actor: 'Ahmad (customer)', method: 'GET', path: () => '/users', token: (c) => c.ahmad.token, expect: 403, why: 'Admin-only route.' },
  { group: 'Customer → Admin actions', title: 'Read sales statistics', actor: 'Ahmad (customer)', method: 'GET', path: () => '/orders/stats', token: (c) => c.ahmad.token, expect: 403, why: 'Admin-only route, also checked inside orders-service.' },
  { group: 'Customer → Admin actions', title: 'Read system information', actor: 'Ahmad (customer)', method: 'GET', path: () => '/system/info', token: (c) => c.ahmad.token, expect: 403, why: 'Admin-only route.' },

  // ─── Horizontal escalation: customer → another customer ───
  { group: "Customer → another customer's data", title: "Open Sara's order", actor: 'Ahmad (customer)', method: 'GET', path: (c) => `/orders/${c.saraOrderId}`, token: (c) => c.ahmad.token, expect: 403, why: 'orders-service compares order.userId with the caller.' },
  { group: "Customer → another customer's data", title: "Cancel Sara's order", actor: 'Ahmad (customer)', method: 'POST', path: (c) => `/orders/${c.saraOrderId}/cancel`, token: (c) => c.ahmad.token, expect: 403, why: 'Ownership is checked before anything else.' },
  { group: "Customer → another customer's data", title: "Mark Sara's notification as read", actor: 'Ahmad (customer)', method: 'PATCH', path: (c) => `/notifications/${c.saraNotificationId}/read`, token: (c) => c.ahmad.token, expect: 403, why: 'notifications-service checks the owner.' },
  { group: "Customer → another customer's data", title: 'Order list only contains own orders', actor: 'Ahmad (customer)', method: 'GET', path: () => '/orders?limit=100', token: (c) => c.ahmad.token, expect: 200, check: (r, c) => (r.body as Paginated<Order>).data.every((o) => o.userId === c.ahmad.user.id), why: 'The service forces userId = caller for customers.' },

  // ─── Input validation ───
  { group: 'Input validation', title: 'Upload a non-image disguised as .png', actor: 'Admin', method: 'POST', path: (c) => `/products/${c.productId}/images`, token: (c) => c.admin, form: () => fakePngForm(), expect: 400, why: 'The real file type is read from its first bytes (magic number).' },
  { group: 'Input validation', title: 'Order a negative quantity', actor: 'Ahmad (customer)', method: 'POST', path: () => '/orders', token: (c) => c.ahmad.token, body: (c) => ({ items: [{ productId: c.productId, quantity: -5 }], shippingAddress: 'Somewhere 1' }), expect: 400, why: 'class-validator: quantity must be ≥ 1.' },
  { group: 'Input validation', title: 'Invalid id in the URL', actor: 'Admin', method: 'GET', path: () => '/orders/1%20OR%201=1', token: (c) => c.admin, expect: 400, why: 'ParseUUIDPipe rejects anything that is not a UUID.' },

  // ─── Controls: allowed access still works ───
  { group: 'Controls (must be allowed)', title: 'Sara opens her own order', actor: 'Sara (customer)', method: 'GET', path: (c) => `/orders/${c.saraOrderId}`, token: (c) => c.sara.token, expect: 200, why: 'The owner can read it.' },
  { group: 'Controls (must be allowed)', title: "Admin opens Sara's order", actor: 'Admin', method: 'GET', path: (c) => `/orders/${c.saraOrderId}`, token: (c) => c.admin, expect: 200, why: 'Admins can read every order.' },
];

const PNG_1PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
function pngForm() {
  const bytes = Uint8Array.from(atob(PNG_1PX), (c) => c.charCodeAt(0));
  const fd = new FormData();
  fd.append('file', new Blob([bytes], { type: 'image/png' }), 'photo.png');
  return fd;
}
function fakePngForm() {
  const fd = new FormData();
  fd.append('file', new Blob(['MZ\x90\x00 this is an executable, not an image'], { type: 'image/png' }), 'photo.png');
  return fd;
}

interface Result extends RawResponse {
  pass: boolean;
}

const ACTOR_TONE: Record<string, 'gray' | 'blue' | 'indigo' | 'red' | 'amber'> = {
  Anonymous: 'gray',
  Attacker: 'red',
  'Ahmad (customer)': 'blue',
  'Sara (customer)': 'amber',
  Admin: 'indigo',
};

export default function SecurityLabPage() {
  const [ctx, setCtx] = useState<Ctx | null>(null);
  const [setupError, setSetupError] = useState<ApiError | null>(null);
  const [results, setResults] = useState<Record<number, Result>>({});
  const [running, setRunning] = useState<number | 'all' | null>(null);
  const [open, setOpen] = useState<number | null>(null);

  async function setup(): Promise<Ctx | null> {
    if (ctx) return ctx;
    setSetupError(null);
    const login = async (email: string) => {
      const r = await raw<{ accessToken: string; user: User }>('/auth/login', { method: 'POST', body: { email, password: DEMO_PASSWORD }, token: null });
      if (r.status !== 200) throw new ApiError(r.status, r.body as never);
      return { token: r.body.accessToken, user: r.body.user };
    };
    try {
      const [ahmad, sara] = [await login('ahmad@shop.local'), await login('sara@shop.local')];
      const [orders, notes, products] = await Promise.all([
        raw<Paginated<Order>>('/orders?limit=1', { token: sara.token }),
        raw<Paginated<{ id: string }>>('/notifications?limit=1', { token: sara.token }),
        raw<Paginated<Product>>('/products?limit=1'),
      ]);
      const saraOrderId = orders.body.data?.[0]?.id;
      const productId = products.body.data?.[0]?.id;
      if (!saraOrderId || !productId) throw new ApiError(0, { message: 'Demo data missing: run "npm run seed" in backend/' } as never);
      const c: Ctx = { admin: getTokens()?.accessToken ?? '', ahmad, sara, saraOrderId, saraNotificationId: notes.body.data?.[0]?.id ?? null, productId };
      setCtx(c);
      return c;
    } catch (e) {
      setSetupError(e instanceof ApiError ? e : new ApiError(0));
      return null;
    }
  }

  async function runOne(i: number, c: Ctx) {
    const s = SCENARIOS[i];
    const r = await raw(s.path(c), { method: s.method, token: s.token(c), body: s.body?.(c), form: s.form?.() });
    const pass = r.status === s.expect && (s.check ? s.check(r, c) : true);
    setResults((prev) => ({ ...prev, [i]: { ...r, pass } }));
  }

  async function run(i: number | 'all') {
    setRunning(i);
    const c = await setup();
    if (c) {
      if (i === 'all') for (let k = 0; k < SCENARIOS.length; k++) await runOne(k, c);
      else await runOne(i, c);
    }
    setRunning(null);
  }

  const done = Object.values(results);
  const passed = done.filter((r) => r.pass).length;
  let lastGroup = '';

  return (
    <>
      <PageHeader
        title="Security lab"
        subtitle="Live requests that try to cross permission boundaries. Every attack must be rejected by the server."
        action={<Button onClick={() => run('all')} loading={running === 'all'}>▶ Run all attacks</Button>}
      />

      {ctx && (
        <div className="mb-4 flex flex-wrap gap-2 text-xs text-slate-600">
          <Badge tone="blue">Ahmad: {ctx.ahmad.user.email}</Badge>
          <Badge tone="amber">Sara: {ctx.sara.user.email}</Badge>
          <Badge>Target order: {shortId(ctx.saraOrderId)} (Sara&apos;s)</Badge>
        </div>
      )}
      <ErrorBox error={setupError} />

      {done.length > 0 && (
        <div className={`mb-4 rounded-xl p-4 text-sm font-medium ${passed === done.length ? 'bg-emerald-50 text-emerald-800' : 'bg-rose-50 text-rose-800'}`}>
          {passed === done.length ? '✅' : '❌'} {passed} / {done.length} checks behaved as expected
        </div>
      )}

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <tbody>
              {SCENARIOS.map((s, i) => {
                const r = results[i];
                const header = s.group !== lastGroup;
                lastGroup = s.group;
                return (
                  <Fragment key={i}>
                    {header && (
                      <tr>
                        <td colSpan={6} className="pb-2 pt-5 text-xs font-semibold uppercase tracking-wide text-slate-500 first:pt-0">{s.group}</td>
                      </tr>
                    )}
                    <tr className="border-t border-slate-100">
                      <td className="py-2.5 pr-3">
                        <p className="font-medium text-slate-900">{s.title}</p>
                        <p className="text-xs text-slate-500">{s.why}</p>
                      </td>
                      <td className="py-2.5 pr-3"><Badge tone={ACTOR_TONE[s.actor] ?? 'gray'}>{s.actor}</Badge></td>
                      <td className="whitespace-nowrap py-2.5 pr-3 font-mono text-xs text-slate-600">
                        {s.method} {ctx ? s.path(ctx).replace(/[0-9a-f-]{36}/g, (m) => `{${m.slice(0, 8)}}`) : s.path({ saraOrderId: ':id', productId: ':id', saraNotificationId: ':id' } as Ctx)}
                      </td>
                      <td className="whitespace-nowrap py-2.5 pr-3 text-xs text-slate-500">expect <b className="text-slate-800">{s.expect}</b></td>
                      <td className="py-2.5 pr-3">
                        {r && (
                          <button onClick={() => setOpen(open === i ? null : i)} className="flex items-center gap-2">
                            <Badge tone={r.pass ? 'green' : 'red'}>{r.pass ? '✓' : '✗'} {r.status}</Badge>
                            <span className="text-xs text-slate-400">{r.ms} ms ▾</span>
                          </button>
                        )}
                      </td>
                      <td className="py-2.5 text-right">
                        <Button variant="secondary" size="sm" loading={running === i} disabled={running !== null} onClick={() => run(i)}>Run</Button>
                      </td>
                    </tr>
                    {open === i && r && (
                      <tr>
                        <td colSpan={6} className="pb-3">
                          <pre className="max-h-64 overflow-auto rounded-lg bg-slate-900 p-3 text-xs text-slate-100">{`HTTP ${r.status}\n${JSON.stringify(r.body, null, 2)}`}</pre>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <BruteForce />
        <RateLimit />
      </div>
    </>
  );
}

/** Creates a throw-away account and guesses its password until it locks. */
function BruteForce() {
  const [log, setLog] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  async function attack() {
    setBusy(true);
    const email = `victim.${Date.now()}@test.local`;
    const lines: string[] = [];
    const push = (l: string) => {
      lines.push(l);
      setLog([...lines]);
    };
    const reg = await raw('/auth/register', { method: 'POST', body: { email, password: DEMO_PASSWORD, name: 'Lab Victim' }, token: null });
    push(`register ${email} → ${reg.status}`);
    for (let i = 1; i <= 5; i++) {
      const r = await raw('/auth/login', { method: 'POST', body: { email, password: `Guess${i}@pass` }, token: null });
      push(`wrong password #${i} → ${r.status}`);
    }
    const r = await raw<{ message: string }>('/auth/login', { method: 'POST', body: { email, password: DEMO_PASSWORD }, token: null });
    push(`CORRECT password → ${r.status} ${r.status === 423 ? '🔒 ' + r.body.message : ''}`);
    setBusy(false);
  }

  return (
    <Card title="Brute-force protection (account lockout)" action={<Button size="sm" variant="secondary" loading={busy} onClick={attack}>Run</Button>}>
      <p className="mb-3 text-sm text-slate-600">5 wrong passwords lock the account for 15 minutes. After that even the correct password gets <b>423 Locked</b>.</p>
      <pre className="min-h-24 rounded-lg bg-slate-900 p-3 text-xs text-slate-100">{log.join('\n') || 'Not run yet'}</pre>
    </Card>
  );
}

/** Hammers the login route until the per-IP rate limiter answers 429. */
function RateLimit() {
  const [log, setLog] = useState<string>('');
  const [busy, setBusy] = useState(false);

  async function attack() {
    setBusy(true);
    let n = 0;
    let status = 0;
    while (n < 60 && status !== 429) {
      n++;
      status = (await raw('/auth/login', { method: 'POST', body: { email: 'nobody@test.local', password: 'Wrong@1234' }, token: null })).status;
      setLog(`request #${n} → ${status}`);
    }
    setLog(status === 429 ? `request #${n} → 429 Too Many Requests 🚫\nLogin from this IP is blocked for up to 60 seconds.` : `no 429 after ${n} requests`);
    setBusy(false);
  }

  return (
    <Card title="Rate limiting (per IP)" action={<Button size="sm" variant="secondary" loading={busy} onClick={attack}>Run</Button>}>
      <p className="mb-3 text-sm text-slate-600">
        Login is limited per IP address. <b>Note:</b> this blocks every login from this machine (including the mobile emulator) for up to a minute.
      </p>
      <pre className="min-h-24 rounded-lg bg-slate-900 p-3 text-xs text-slate-100">{log || 'Not run yet'}</pre>
    </Card>
  );
}
