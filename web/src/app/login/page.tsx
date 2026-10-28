'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Button, ErrorBox, Field, Input } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';

const DEMO = [
  { label: 'Admin', email: 'admin@shop.local', password: 'Admin@12345' },
  { label: 'Customer (Ahmad)', email: 'ahmad@shop.local', password: 'Customer@123' },
];

export default function LoginPage() {
  const { user, login } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (user) router.replace('/');
  }, [user, router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
      router.replace('/');
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError(0));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-indigo-50 via-white to-slate-100 px-4">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-600 text-xl text-white">🛒</div>
          <h1 className="text-2xl font-bold text-slate-900">E-Commerce Admin</h1>
          <p className="mt-1 text-sm text-slate-500">Dashboard for managing the store</p>
        </div>

        <form onSubmit={submit} className="space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <Field label="Email">
            <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
          </Field>
          <Field label="Password">
            <Input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
          </Field>
          <ErrorBox error={error} />
          <Button type="submit" className="w-full" loading={busy}>
            Sign in
          </Button>

          <div className="border-t border-slate-100 pt-4">
            <p className="mb-2 text-xs font-medium text-slate-500">Demo accounts (after running the seed)</p>
            <div className="flex flex-wrap gap-2">
              {DEMO.map((d) => (
                <button
                  key={d.email}
                  type="button"
                  onClick={() => {
                    setEmail(d.email);
                    setPassword(d.password);
                  }}
                  className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-700 hover:bg-indigo-100 hover:text-indigo-800"
                >
                  {d.label}
                </button>
              ))}
            </div>
          </div>
        </form>
      </div>
    </main>
  );
}
