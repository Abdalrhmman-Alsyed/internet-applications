'use client';

import Link from 'next/link';
import { Badge, Card, ErrorBox, Loading, PageHeader, STATUS_TONE, StatusBadge, Table, Td } from '@/components/ui';
import { dateTime, money, shortId } from '@/lib/api';
import { useRealtime } from '@/lib/realtime';
import type { Order, OrderStats, Paginated, Product, User } from '@/lib/types';
import { ORDER_STATUSES } from '@/lib/types';
import { useApi } from '@/lib/use-api';
import { useEffect } from 'react';

const BAR_COLORS: Record<string, string> = {
  amber: 'bg-amber-400',
  blue: 'bg-sky-500',
  indigo: 'bg-indigo-500',
  green: 'bg-emerald-500',
  red: 'bg-rose-500',
};

export default function OverviewPage() {
  const stats = useApi<OrderStats>('/orders/stats');
  const products = useApi<Paginated<Product>>('/products?limit=1');
  const customers = useApi<Paginated<User>>('/users?role=CUSTOMER&limit=1');
  const lowStock = useApi<Paginated<Product>>('/products?maxStock=5&sort=name&limit=8');
  const recent = useApi<Paginated<Order>>('/orders?limit=6');
  const { unreadBump } = useRealtime();

  // New orders arrive as live notifications: refresh the figures.
  useEffect(() => {
    if (unreadBump === 0) return;
    stats.reload();
    recent.reload();
    lowStock.reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unreadBump]);

  if (stats.error) return <ErrorBox error={stats.error} />;
  if (!stats.data) return <Loading />;
  const s = stats.data;
  const maxDay = Math.max(1, ...s.last7Days.map((d) => d.orders));

  return (
    <>
      <PageHeader title="Overview" subtitle="Live figures from orders-service, products-service and users-service" />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Revenue" value={money(s.revenue)} hint="excluding cancelled" icon="💰" />
        <Kpi label="Orders" value={s.totalOrders} hint={`${s.byStatus.PENDING} pending`} icon="🧾" />
        <Kpi label="Products" value={products.data?.meta.total ?? '…'} hint="active in catalogue" icon="📦" />
        <Kpi label="Customers" value={customers.data?.meta.total ?? '…'} hint="registered" icon="👥" />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <Card title="Orders, last 7 days" className="xl:col-span-2">
          <div className="flex h-48 items-end gap-3">
            {s.last7Days.map((d) => (
              <div key={d.date} className="flex flex-1 flex-col items-center gap-1">
                <span className="text-xs font-medium text-slate-600">{d.orders || ''}</span>
                <div className="w-full rounded-t-md bg-indigo-500 transition-all" style={{ height: `${(d.orders / maxDay) * 150}px`, minHeight: 2 }} title={`${d.orders} orders · ${money(d.revenue)}`} />
                <span className="text-[11px] text-slate-400">{new Date(d.date).toLocaleDateString('en-GB', { weekday: 'short' })}</span>
              </div>
            ))}
          </div>
        </Card>

        <Card title="Orders by status">
          <div className="space-y-3">
            {ORDER_STATUSES.map((st) => (
              <div key={st}>
                <div className="mb-1 flex justify-between text-xs">
                  <StatusBadge status={st} />
                  <span className="font-medium text-slate-700">{s.byStatus[st]}</span>
                </div>
                <div className="h-2 rounded-full bg-slate-100">
                  <div
                    className={`h-2 rounded-full ${BAR_COLORS[STATUS_TONE[st]]}`}
                    style={{ width: `${s.totalOrders ? (s.byStatus[st] / s.totalOrders) * 100 : 0}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <Card title="Latest orders" className="xl:col-span-2" action={<Link href="/orders" className="text-xs text-indigo-600 hover:underline">View all →</Link>}>
          {recent.data ? (
            <Table head={['Order', 'Items', 'Total', 'Status', 'Date']}>
              {recent.data.data.map((o) => (
                <tr key={o.id}>
                  <Td className="font-mono text-xs">{shortId(o.id)}</Td>
                  <Td>{o.items.reduce((n, i) => n + i.quantity, 0)}</Td>
                  <Td>{money(o.total)}</Td>
                  <Td><StatusBadge status={o.status} /></Td>
                  <Td className="text-slate-500">{dateTime(o.createdAt)}</Td>
                </tr>
              ))}
            </Table>
          ) : (
            <Loading />
          )}
        </Card>

        <Card title="Low stock (≤ 5)" action={<Link href="/products" className="text-xs text-indigo-600 hover:underline">Manage →</Link>}>
          {lowStock.data?.data.length ? (
            <ul className="divide-y divide-slate-100 text-sm">
              {lowStock.data.data.map((p) => (
                <li key={p.id} className="flex items-center justify-between py-2">
                  <span className="truncate pr-2">{p.name}</span>
                  <Badge tone={p.stock === 0 ? 'red' : 'amber'}>{p.stock} left</Badge>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-500">All products are well stocked.</p>
          )}
        </Card>
      </div>
    </>
  );
}

function Kpi({ label, value, hint, icon }: { label: string; value: React.ReactNode; hint: string; icon: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">{label}</p>
        <span className="text-xl">{icon}</span>
      </div>
      <p className="mt-2 text-2xl font-bold text-slate-900">{value}</p>
      <p className="mt-1 text-xs text-slate-400">{hint}</p>
    </div>
  );
}
