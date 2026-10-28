'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Sidebar } from '@/components/sidebar';
import { Button, Loading } from '@/components/ui';
import { raw, type RawResponse } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { RealtimeProvider } from '@/lib/realtime';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) router.replace('/login');
  }, [loading, user, router]);

  if (loading || !user) return <Loading />;
  if (user.role !== 'ADMIN') return <CustomerBlocked />;

  return (
    <RealtimeProvider>
      <div className="min-h-screen lg:flex">
        <Sidebar />
        <main className="min-w-0 flex-1 px-4 py-6 sm:px-8 lg:py-8">{children}</main>
      </div>
    </RealtimeProvider>
  );
}

/**
 * A customer who signs in here is not just hidden from the UI: we call an admin
 * endpoint with their token and show the API's own rejection.
 */
function CustomerBlocked() {
  const { user, logout } = useAuth();
  const [res, setRes] = useState<RawResponse | null>(null);

  useEffect(() => {
    raw('/orders/stats').then(setRes);
  }, []);

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-xl rounded-xl border border-rose-200 bg-white p-6 shadow-sm">
        <div className="mb-4 flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-rose-100 text-xl">⛔</span>
          <div>
            <h1 className="text-lg font-bold text-slate-900">Access denied</h1>
            <p className="text-sm text-slate-500">
              {user?.email} is a <b>CUSTOMER</b>. The dashboard is for admins only.
            </p>
          </div>
        </div>
        <p className="mb-2 text-sm text-slate-600">
          The server enforces this too. Here is the response to <code className="rounded bg-slate-100 px-1">GET /api/v1/orders/stats</code> with your token:
        </p>
        <pre className="max-h-72 overflow-auto rounded-lg bg-slate-900 p-4 text-xs text-rose-300">
          {res ? `HTTP ${res.status}\n${JSON.stringify(res.body, null, 2)}` : 'Requesting…'}
        </pre>
        <Button variant="secondary" className="mt-4" onClick={logout}>
          Sign out
        </Button>
      </div>
    </main>
  );
}
