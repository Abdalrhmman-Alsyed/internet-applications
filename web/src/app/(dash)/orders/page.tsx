'use client';

import { useEffect, useMemo, useState } from 'react';
import { useToast } from '@/components/toasts';
import { Button, Card, Empty, ErrorBox, Loading, Modal, PageHeader, Pagination, StatusBadge, Table, Td } from '@/components/ui';
import { api, ApiError, dateTime, money, shortId } from '@/lib/api';
import { useRealtime } from '@/lib/realtime';
import type { Order, OrderStatus, Paginated, User } from '@/lib/types';
import { NEXT_STATUSES, ORDER_STATUSES } from '@/lib/types';
import { useApi } from '@/lib/use-api';

export default function OrdersPage() {
  const [status, setStatus] = useState<OrderStatus | ''>('');
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);
  const { unreadBump } = useRealtime();

  const params = new URLSearchParams({ page: String(page), limit: '15' });
  if (status) params.set('status', status);
  const list = useApi<Paginated<Order>>(`/orders?${params}`);
  const users = useApi<Paginated<User>>('/users?limit=100');
  const names = useMemo(() => new Map(users.data?.data.map((u) => [u.id, u]) ?? []), [users.data]);

  useEffect(() => {
    if (unreadBump) list.reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unreadBump]);

  return (
    <>
      <PageHeader title="Orders" subtitle="Admins see every order and move it through its lifecycle" />
      <Card>
        <div className="mb-4 flex flex-wrap gap-2">
          {(['', ...ORDER_STATUSES] as const).map((s) => (
            <button
              key={s || 'all'}
              onClick={() => { setStatus(s); setPage(1); }}
              className={`rounded-full px-3 py-1 text-xs font-medium ${status === s ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
            >
              {s || 'All'}
            </button>
          ))}
        </div>
        <ErrorBox error={list.error} />
        {!list.data ? <Loading /> : list.data.data.length === 0 ? <Empty>No orders.</Empty> : (
          <Table head={['Order', 'Customer', 'Items', 'Total', 'Status', 'Placed', '']}>
            {list.data.data.map((o) => (
              <tr key={o.id} className="cursor-pointer hover:bg-slate-50" onClick={() => setOpenId(o.id)}>
                <Td className="font-mono text-xs">{shortId(o.id)}</Td>
                <Td>
                  <p>{names.get(o.userId)?.name ?? '—'}</p>
                  <p className="text-xs text-slate-400">{names.get(o.userId)?.email}</p>
                </Td>
                <Td>{o.items.reduce((n, i) => n + i.quantity, 0)}</Td>
                <Td className="font-medium">{money(o.total)}</Td>
                <Td><StatusBadge status={o.status} /></Td>
                <Td className="text-slate-500">{dateTime(o.createdAt)}</Td>
                <Td className="text-right text-indigo-600">Open →</Td>
              </tr>
            ))}
          </Table>
        )}
        {list.data && <Pagination page={page} totalPages={list.data.meta.totalPages} onChange={setPage} />}
      </Card>

      {openId && (
        <OrderModal id={openId} customer={names.get(list.data?.data.find((o) => o.id === openId)?.userId ?? '')} onClose={() => setOpenId(null)} onChanged={list.reload} />
      )}
    </>
  );
}

function OrderModal({ id, customer, onClose, onChanged }: { id: string; customer?: User; onClose: () => void; onChanged: () => void }) {
  const toast = useToast();
  const order = useApi<Order>(`/orders/${id}`);
  const [busy, setBusy] = useState<OrderStatus | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  async function move(to: OrderStatus) {
    setBusy(to);
    setError(null);
    try {
      const updated = await api<Order>(`/orders/${id}/status`, { method: 'PATCH', body: { status: to } });
      order.setData(updated);
      onChanged();
      toast('success', `Order ${shortId(id)} → ${to}`, 'The customer was notified in real time.');
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError(0));
    } finally {
      setBusy(null);
    }
  }

  const o = order.data;
  return (
    <Modal open title={`Order ${shortId(id)}`} onClose={onClose} wide>
      {!o ? <Loading /> : (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm">
              <p className="font-medium text-slate-900">{customer?.name ?? o.userId}</p>
              <p className="text-slate-500">{customer?.email}</p>
              <p className="mt-1 text-slate-500">📍 {o.shippingAddress}</p>
            </div>
            <StatusBadge status={o.status} />
          </div>

          <Table head={['Product', 'Unit price', 'Qty', 'Subtotal']}>
            {o.items.map((i) => (
              <tr key={i.id}>
                <Td>{i.productName}</Td>
                <Td>{money(i.unitPrice)}</Td>
                <Td>{i.quantity}</Td>
                <Td className="font-medium">{money(i.subtotal)}</Td>
              </tr>
            ))}
            <tr>
              <Td /><Td /><Td className="font-semibold">Total</Td><Td className="font-bold">{money(o.total)}</Td>
            </tr>
          </Table>

          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">History</p>
            <ol className="space-y-2 border-l-2 border-slate-200 pl-4">
              {o.history.map((h) => (
                <li key={h.id} className="text-sm">
                  <StatusBadge status={h.status} /> <span className="text-slate-500">{dateTime(h.createdAt)}</span>
                  {h.note && <span className="text-slate-600"> · {h.note}</span>}
                </li>
              ))}
            </ol>
          </div>

          <div className="border-t border-slate-100 pt-4">
            {NEXT_STATUSES[o.status].length ? (
              <div className="flex flex-wrap gap-2">
                {NEXT_STATUSES[o.status].map((s) => (
                  <Button key={s} variant={s === 'CANCELLED' ? 'danger' : 'primary'} loading={busy === s} onClick={() => move(s)}>
                    {s === 'CANCELLED' ? 'Cancel order' : `Mark ${s.toLowerCase()}`}
                  </Button>
                ))}
              </div>
            ) : (
              <p className="text-sm text-slate-500">This order is final ({o.status}).</p>
            )}
          </div>
          <ErrorBox error={error} />
        </div>
      )}
    </Modal>
  );
}
