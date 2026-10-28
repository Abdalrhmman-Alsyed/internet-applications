'use client';

import { useEffect, useState } from 'react';
import { Badge, Button, Card, Empty, ErrorBox, Loading, PageHeader, Pagination } from '@/components/ui';
import { api, dateTime } from '@/lib/api';
import { useRealtime } from '@/lib/realtime';
import type { AppNotification, Paginated } from '@/lib/types';
import { useApi } from '@/lib/use-api';

const ICONS: Record<string, string> = {
  'order.created': '🧾',
  'order.status_changed': '🚚',
  'product.low_stock': '⚠️',
  'user.registered': '👋',
};

export default function NotificationsPage() {
  const [page, setPage] = useState(1);
  const list = useApi<Paginated<AppNotification> & { unread: number }>(`/notifications?page=${page}&limit=20`);
  const { unreadBump, connected } = useRealtime();

  useEffect(() => {
    if (unreadBump) list.reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unreadBump]);

  async function markAll() {
    await api('/notifications/read-all', { method: 'PATCH' });
    list.reload();
  }

  async function markOne(n: AppNotification) {
    if (n.readAt) return;
    await api(`/notifications/${n.id}/read`, { method: 'PATCH' });
    list.reload();
  }

  return (
    <>
      <PageHeader
        title="Notifications"
        subtitle={`Produced by RabbitMQ events, pushed over Socket.io (${connected ? 'connected' : 'disconnected'})`}
        action={<Button variant="secondary" onClick={markAll} disabled={!list.data?.unread}>Mark all as read ({list.data?.unread ?? 0})</Button>}
      />
      <Card>
        <ErrorBox error={list.error} />
        {!list.data ? <Loading /> : list.data.data.length === 0 ? <Empty>No notifications yet.</Empty> : (
          <ul className="divide-y divide-slate-100">
            {list.data.data.map((n) => (
              <li key={n.id} onClick={() => markOne(n)} className={`flex cursor-pointer gap-3 px-2 py-3 ${n.readAt ? '' : 'bg-indigo-50/50'}`}>
                <span className="text-xl">{ICONS[n.type] ?? '🔔'}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium text-slate-900">{n.title}</p>
                    <Badge tone={n.audience === 'ADMINS' ? 'indigo' : 'gray'}>{n.audience === 'ADMINS' ? 'All admins' : 'Personal'}</Badge>
                    {!n.readAt && <Badge tone="blue">New</Badge>}
                  </div>
                  <p className="text-sm text-slate-600">{n.body}</p>
                </div>
                <span className="whitespace-nowrap text-xs text-slate-400">{dateTime(n.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
        {list.data && <Pagination page={page} totalPages={list.data.meta.totalPages} onChange={setPage} />}
      </Card>
    </>
  );
}
