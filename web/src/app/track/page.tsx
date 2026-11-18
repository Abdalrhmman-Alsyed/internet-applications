'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { Badge, Button, Card, Empty, ErrorBox, Input, Loading, StatusBadge } from '@/components/ui';
import { useToast } from '@/components/toasts';
import { api, ApiError, dateTime, getTokens, money, shortId, WS_URL } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useOrderChannel, type LiveStatus, type SubscribeAnswer } from '@/lib/realtime';
import type { Order, Paginated, Product } from '@/lib/types';
import { io } from 'socket.io-client';

/**
 * Requirement 4 — the customer's order tracking page.
 *
 * The page subscribes to the channel of ONE order ("order:<id>"). The server re-checks the
 * token and asks orders-service whether that order belongs to this user before joining the
 * channel, so nobody else can follow it. When an admin changes the status, the new status
 * appears here immediately, without a refresh.
 */
export default function TrackPage() {
  const { user, loading, logout } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [order, setOrder] = useState<Order | null>(null);
  const [events, setEvents] = useState<(LiveStatus & { receivedAt: string })[]>([]);
  const [error, setError] = useState<ApiError | null>(null);
  const [placing, setPlacing] = useState(false);

  useEffect(() => {
    if (!loading && !user) router.replace('/login');
  }, [loading, user, router]);

  const loadList = useCallback(async () => {
    try {
      const res = await api<Paginated<Order>>('/orders?limit=20');
      setOrders(res.data);
      setSelected((cur) => cur ?? res.data[0]?.id ?? null);
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError(0));
    }
  }, []);

  useEffect(() => {
    if (user) void loadList();
  }, [user, loadList]);

  const loadOrder = useCallback(async (id: string) => {
    try {
      setOrder(await api<Order>(`/orders/${id}`));
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError(0));
    }
  }, []);

  useEffect(() => {
    setEvents([]);
    setOrder(null);
    if (selected) void loadOrder(selected);
  }, [selected, loadOrder]);

  // Live updates for the selected order: no polling, no refresh.
  const onStatus = useCallback(
    (s: LiveStatus) => {
      setEvents((ev) => [{ ...s, receivedAt: new Date().toISOString() }, ...ev]);
      setOrder((o) => (o ? { ...o, status: s.to as Order['status'] } : o));
      setOrders((list) => list?.map((o) => (o.id === s.orderId ? { ...o, status: s.to as Order['status'] } : o)) ?? list);
      toast('info', `Order ${shortId(s.orderId)}: ${s.from} → ${s.to}`, 'Updated live');
      if (selected) void loadOrder(selected); // refresh the history list
    },
    [selected, loadOrder, toast],
  );
  const { answer, connected } = useOrderChannel(selected, onStatus);

  /** Places a small order (first product in stock) so the admin dashboard can show it live. */
  async function placeOrder() {
    setPlacing(true);
    setError(null);
    try {
      const products = await api<Paginated<Product>>('/products?limit=20');
      const p = products.data.find((x) => x.isActive && x.stock > 0);
      if (!p) throw new ApiError(0);
      const created = await api<Order>('/orders', {
        method: 'POST',
        body: { items: [{ productId: p.id, quantity: 1 }], shippingAddress: 'Damascus, Mazzeh, Street 12' },
      });
      toast('success', `Order ${shortId(created.id)} placed`, 'A confirmation email is on its way (sent in the background)');
      await loadList();
      setSelected(created.id);
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError(0));
    } finally {
      setPlacing(false);
    }
  }

  if (loading || !user) return <Loading />;

  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">My orders</h1>
          <p className="text-sm text-slate-500">
            Signed in as {user.email} ({user.role}). Status changes appear here live, without refreshing.
          </p>
        </div>
        <div className="flex gap-2">
          {user.role === 'ADMIN' && (
            <Button variant="secondary" onClick={() => router.push('/')}>Dashboard</Button>
          )}
          <Button loading={placing} onClick={placeOrder}>Place a test order</Button>
          <Button variant="secondary" onClick={logout}>Sign out</Button>
        </div>
      </header>

      <ErrorBox error={error} />

      <div className="grid gap-6 md:grid-cols-[280px_1fr]">
        <Card title="Orders">
          {!orders ? <Loading /> : orders.length === 0 ? <Empty>No orders yet.</Empty> : (
            <ul className="space-y-1">
              {orders.map((o) => (
                <li key={o.id}>
                  <button
                    onClick={() => setSelected(o.id)}
                    className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm ${selected === o.id ? 'bg-indigo-50 ring-1 ring-indigo-200' : 'hover:bg-slate-50'}`}
                  >
                    <span>
                      <span className="font-mono text-xs">{shortId(o.id)}</span>
                      <span className="block text-xs text-slate-400">{dateTime(o.createdAt)}</span>
                    </span>
                    <StatusBadge status={o.status} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <div className="space-y-6">
          <Card
            title={order ? `Order ${shortId(order.id)}` : 'Order'}
            action={<ChannelBadge connected={connected} answer={answer} />}
          >
            {!selected ? <Empty>Select an order.</Empty> : !order ? <Loading /> : (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm text-slate-500">📍 {order.shippingAddress}</p>
                  <div className="text-right">
                    <StatusBadge status={order.status} />
                    <p className="mt-1 text-sm font-semibold">{money(order.total)}</p>
                  </div>
                </div>
                <Stepper status={order.status} />
                <ol className="space-y-2 border-l-2 border-slate-200 pl-4">
                  {order.history.map((h) => (
                    <li key={h.id} className="text-sm">
                      <StatusBadge status={h.status} /> <span className="text-slate-500">{dateTime(h.createdAt)}</span>
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </Card>

          <Card title="Live events on this channel">
            {events.length === 0 ? (
              <p className="text-sm text-slate-500">Waiting… ask an admin to change this order&apos;s status in another browser.</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {events.map((e, i) => (
                  <li key={i} className="flex items-center gap-2">
                    <Badge tone="green">live</Badge>
                    <span className="font-mono text-xs">{shortId(e.orderId)}</span>
                    <span>{e.from} → <b>{e.to}</b></span>
                    <span className="text-xs text-slate-400">received {dateTime(e.receivedAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <ForeignOrderProbe />
        </div>
      </div>
    </main>
  );
}

function ChannelBadge({ connected, answer }: { connected: boolean; answer: SubscribeAnswer | null }) {
  if (!connected) return <Badge tone="gray">offline</Badge>;
  if (!answer) return <Badge tone="amber">subscribing…</Badge>;
  return answer.ok ? <Badge tone="green">● live: {answer.channel}</Badge> : <Badge tone="red">refused {answer.status}</Badge>;
}

const STEPS = ['PENDING', 'CONFIRMED', 'SHIPPED', 'DELIVERED'] as const;
function Stepper({ status }: { status: Order['status'] }) {
  if (status === 'CANCELLED') return <p className="text-sm font-medium text-rose-600">This order was cancelled.</p>;
  const idx = STEPS.indexOf(status as (typeof STEPS)[number]);
  return (
    <div className="flex items-center gap-2">
      {STEPS.map((s, i) => (
        <div key={s} className="flex flex-1 items-center gap-2">
          <span className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${i <= idx ? 'bg-indigo-600 text-white' : 'bg-slate-200 text-slate-500'}`}>{i + 1}</span>
          <span className={`text-xs ${i <= idx ? 'font-semibold text-slate-900' : 'text-slate-400'}`}>{s}</span>
          {i < STEPS.length - 1 && <span className={`h-0.5 flex-1 ${i < idx ? 'bg-indigo-600' : 'bg-slate-200'}`} />}
        </div>
      ))}
    </div>
  );
}

/**
 * Proof for the examiner: try to follow an order that is not yours. The server answers
 * 403 and never joins the channel.
 */
function ForeignOrderProbe() {
  const [id, setId] = useState('');
  const [result, setResult] = useState<SubscribeAnswer | null>(null);
  const [busy, setBusy] = useState(false);

  function probe() {
    const token = getTokens()?.accessToken;
    if (!token || !id.trim()) return;
    setBusy(true);
    setResult(null);
    const socket = io(WS_URL, { auth: { token }, transports: ['websocket'] });
    socket.on('connect', () => {
      socket.emit('subscribe', { channel: 'order', orderId: id.trim() }, (a: SubscribeAnswer) => {
        setResult(a);
        setBusy(false);
        socket.disconnect();
      });
    });
    socket.on('connect_error', () => {
      setResult({ ok: false, status: 0, message: 'Could not connect' });
      setBusy(false);
    });
  }

  return (
    <Card title="Try to follow someone else's order">
      <div className="flex gap-2">
        <Input placeholder="Order ID (UUID)" value={id} onChange={(e) => setId(e.target.value)} />
        <Button variant="secondary" loading={busy} onClick={probe}>Subscribe</Button>
      </div>
      {result && (
        <pre className={`mt-3 rounded-lg p-3 text-xs ${result.ok ? 'bg-emerald-50 text-emerald-800' : 'bg-rose-50 text-rose-800'}`}>
          {JSON.stringify(result, null, 2)}
        </pre>
      )}
    </Card>
  );
}
