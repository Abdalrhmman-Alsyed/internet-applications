'use client';

import { useEffect, useState } from 'react';
import { Badge, Card, ErrorBox, Loading, PageHeader } from '@/components/ui';
import { API_URL } from '@/lib/api';
import type { SystemInfo } from '@/lib/types';
import { useApi } from '@/lib/use-api';

interface Endpoint {
  method: string;
  path: string;
  summary: string;
  tag: string;
  auth: boolean;
}

const SERVICE_INFO: Record<string, { port: string; db: string; owns: string }> = {
  users: { port: 'TCP 3001', db: 'users_db', owns: 'Accounts, login, JWT, lockout' },
  products: { port: 'TCP 3002', db: 'products_db + MinIO', owns: 'Catalogue, images, stock reservation' },
  orders: { port: 'TCP 3003', db: 'orders_db', owns: 'Orders, ownership checks, status flow' },
  notifications: { port: 'TCP 3005 · WS 3004', db: 'notifications_db', owns: 'RabbitMQ consumer, Socket.io pushes' },
};

const METHOD_TONE = { GET: 'green', POST: 'blue', PATCH: 'amber', DELETE: 'red', PUT: 'indigo' } as const;

const uptime = (s: number) => `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m ${s % 60}s`;

export default function SystemPage() {
  const info = useApi<SystemInfo>('/system/info', 5000);
  const [endpoints, setEndpoints] = useState<Endpoint[] | null>(null);

  useEffect(() => {
    fetch(`${API_URL}/docs/openapi.json`)
      .then((r) => r.json())
      .then((doc: { paths: Record<string, Record<string, { summary?: string; tags?: string[]; security?: unknown[] }>> }) =>
        setEndpoints(
          Object.entries(doc.paths).flatMap(([path, ops]) =>
            Object.entries(ops).map(([method, op]) => ({
              method: method.toUpperCase(),
              path,
              summary: op.summary ?? '',
              tag: op.tags?.[0] ?? '',
              auth: Boolean(op.security?.length),
            })),
          ),
        ),
      )
      .catch(() => setEndpoints([]));
  }, []);

  if (info.error) return <ErrorBox error={info.error} />;
  if (!info.data) return <Loading />;
  const d = info.data;

  return (
    <>
      <PageHeader title="System" subtitle="Live backend information (refreshes every 5 s), from GET /api/v1/system/info" />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Object.entries(d.services).map(([name, s]) => (
          <div key={name} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <p className="font-semibold capitalize text-slate-900">{name}-service</p>
              <span className={`h-2.5 w-2.5 rounded-full ${s.status === 'up' ? 'bg-emerald-500' : 'bg-rose-500'}`} />
            </div>
            <p className="mt-1 text-xs text-slate-500">{SERVICE_INFO[name]?.owns}</p>
            <div className="mt-3 flex flex-wrap gap-1.5 text-xs">
              <Badge tone={s.status === 'up' ? 'green' : 'red'}>{s.status === 'up' ? `up · ${s.latencyMs} ms` : 'down'}</Badge>
              <Badge>{SERVICE_INFO[name]?.port}</Badge>
              <Badge tone="indigo">{SERVICE_INFO[name]?.db}</Badge>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <Card title="Architecture" className="xl:col-span-2">
          <Architecture />
        </Card>

        <div className="space-y-6">
          <Card title="API Gateway">
            <dl className="grid grid-cols-2 gap-y-2 text-sm">
              <dt className="text-slate-500">Uptime</dt><dd className="font-medium">{uptime(d.gateway.uptimeSeconds)}</dd>
              <dt className="text-slate-500">Node.js</dt><dd className="font-medium">{d.gateway.nodeVersion}</dd>
              <dt className="text-slate-500">Memory</dt><dd className="font-medium">{d.gateway.memoryMb} MB</dd>
              <dt className="text-slate-500">Mode</dt><dd className="font-medium">{d.gateway.environment}</dd>
            </dl>
          </Card>

          <Card title="Event queue (RabbitMQ)">
            {d.queue ? (
              <dl className="grid grid-cols-2 gap-y-2 text-sm">
                <dt className="text-slate-500">Queue</dt><dd className="font-mono text-xs font-medium">{d.queue.name}</dd>
                <dt className="text-slate-500">Durable</dt><dd className="font-medium">{d.queue.durable ? 'yes' : 'no'}</dd>
                <dt className="text-slate-500">Consumers</dt><dd className="font-medium">{d.queue.consumers}</dd>
                <dt className="text-slate-500">Published</dt><dd className="font-medium">{d.queue.published}</dd>
                <dt className="text-slate-500">Acknowledged</dt><dd className="font-medium">{d.queue.acknowledged}</dd>
                <dt className="text-slate-500">Waiting</dt><dd className="font-medium">{d.queue.pending}</dd>
              </dl>
            ) : (
              <p className="text-sm text-slate-500">Management API unreachable.</p>
            )}
          </Card>
        </div>
      </div>

      <Card title="Security configuration" className="mt-6">
        <div className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <Item label="Authentication" value={d.security.authentication} />
          <Item label="Access token lifetime" value={d.security.accessTokenTtl} />
          <Item label="Refresh token lifetime" value={d.security.refreshTokenTtl} />
          <Item label="Password hashing" value={d.security.passwordHashing} />
          <Item label="Rate limit (all routes)" value={`${d.security.rateLimitPerMinute} req / min / IP`} />
          <Item label="Rate limit (login / register)" value={`${d.security.authRateLimitPerMinute} req / min / IP`} />
          <Item label="Account lockout" value={`after ${d.security.maxFailedLogins} failures, ${d.security.lockMinutes} min`} />
          <Item label="Roles" value={d.security.roles.join(', ')} />
        </div>
      </Card>

      <Card
        title={`API endpoints (${endpoints?.length ?? '…'})`}
        className="mt-6"
        action={
          <div className="flex gap-3 text-xs">
            <a className="text-indigo-600 hover:underline" href={`${API_URL}/docs`} target="_blank" rel="noreferrer">Swagger ↗</a>
            <a className="text-indigo-600 hover:underline" href="http://localhost:15672" target="_blank" rel="noreferrer">RabbitMQ ↗</a>
            <a className="text-indigo-600 hover:underline" href="http://localhost:9001" target="_blank" rel="noreferrer">MinIO ↗</a>
          </div>
        }
      >
        {!endpoints ? <Loading /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <tbody className="divide-y divide-slate-100">
                {endpoints.map((e) => (
                  <tr key={e.method + e.path}>
                    <td className="py-1.5 pr-3"><Badge tone={METHOD_TONE[e.method as keyof typeof METHOD_TONE] ?? 'gray'}>{e.method}</Badge></td>
                    <td className="whitespace-nowrap py-1.5 pr-3 font-mono text-xs">{e.path}</td>
                    <td className="py-1.5 pr-3 text-slate-600">{e.summary}</td>
                    <td className="py-1.5 text-right">
                      {e.summary.startsWith('[Admin]') ? <Badge tone="indigo">Admin</Badge>
                        : e.summary.startsWith('[Customer]') ? <Badge tone="blue">Customer</Badge>
                        : e.auth ? <Badge>Signed in</Badge> : <Badge tone="green">Public</Badge>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}

function Item({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-slate-50 p-3">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-0.5 font-medium text-slate-900">{value}</p>
    </div>
  );
}

function Box({ title, sub, tone = 'bg-white' }: { title: string; sub?: string; tone?: string }) {
  return (
    <div className={`rounded-lg border border-slate-300 px-3 py-2 text-center ${tone}`}>
      <p className="text-sm font-semibold text-slate-900">{title}</p>
      {sub && <p className="text-[11px] text-slate-500">{sub}</p>}
    </div>
  );
}

function Architecture() {
  return (
    <div className="space-y-3 text-xs">
      <div className="grid grid-cols-2 gap-3">
        <Box title="Next.js dashboard" sub=":3001" tone="bg-sky-50" />
        <Box title="Flutter app" sub="Android / iOS" tone="bg-sky-50" />
      </div>
      <p className="text-center text-slate-400">↓ HTTPS + JWT &nbsp;&nbsp;·&nbsp;&nbsp; Socket.io + JWT ↘</p>
      <Box title="API Gateway :3000" sub="JWT · roles · rate limit · validation · Swagger · uniform errors" tone="bg-indigo-50" />
      <p className="text-center text-slate-400">↓ TCP (request / reply)</p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Box title="users" sub="users_db" />
        <Box title="products" sub="products_db · MinIO" />
        <Box title="orders" sub="orders_db" />
        <Box title="notifications" sub="notifications_db" />
      </div>
      <p className="text-center text-slate-400">users · products · orders → events → notifications</p>
      <div className="grid grid-cols-3 gap-3">
        <Box title="RabbitMQ" sub="durable queue, manual ack" tone="bg-amber-50" />
        <Box title="PostgreSQL" sub="database per service" tone="bg-emerald-50" />
        <Box title="MinIO (S3)" sub="product images" tone="bg-rose-50" />
      </div>
    </div>
  );
}
