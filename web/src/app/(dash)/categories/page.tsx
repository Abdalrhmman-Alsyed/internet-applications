'use client';

import { useState } from 'react';
import { useToast } from '@/components/toasts';
import { Button, Card, Empty, ErrorBox, Input, Loading, PageHeader, Table, Td } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import type { Category } from '@/lib/types';
import { useApi } from '@/lib/use-api';

export default function CategoriesPage() {
  const list = useApi<Category[]>('/categories');
  const toast = useToast();
  const [name, setName] = useState('');
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/categories', { method: 'POST', body: { name } });
      toast('success', `Category "${name}" created`);
      setName('');
      list.reload();
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError(0));
    } finally {
      setBusy(false);
    }
  }

  async function remove(c: Category) {
    if (!confirm(`Delete "${c.name}"? Its products become uncategorised.`)) return;
    try {
      await api(`/categories/${c.id}`, { method: 'DELETE' });
      toast('success', 'Category deleted');
      list.reload();
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError(0));
    }
  }

  return (
    <>
      <PageHeader title="Categories" subtitle="Used for filtering products in the store" />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="All categories" className="lg:col-span-2">
          {!list.data ? <Loading /> : list.data.length === 0 ? <Empty>No categories yet.</Empty> : (
            <Table head={['Name', 'Slug', 'Products', '']}>
              {list.data.map((c) => (
                <tr key={c.id}>
                  <Td className="font-medium">{c.name}</Td>
                  <Td className="font-mono text-xs text-slate-500">{c.slug}</Td>
                  <Td>{c._count?.products ?? 0}</Td>
                  <Td className="text-right"><Button variant="ghost" size="sm" onClick={() => remove(c)}>Delete</Button></Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
        <Card title="New category">
          <form onSubmit={create} className="space-y-3">
            <Input required minLength={2} placeholder="e.g. Sports" value={name} onChange={(e) => setName(e.target.value)} />
            <Button type="submit" loading={busy} className="w-full">Create</Button>
            <ErrorBox error={error} />
          </form>
        </Card>
      </div>
    </>
  );
}
