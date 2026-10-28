'use client';

import { useEffect, useState } from 'react';
import { useToast } from '@/components/toasts';
import { Badge, Button, Card, Empty, ErrorBox, Field, Input, Loading, Modal, PageHeader, Pagination, Select, Table, Td, Textarea } from '@/components/ui';
import { api, ApiError, money } from '@/lib/api';
import type { Category, Paginated, Product } from '@/lib/types';
import { useApi } from '@/lib/use-api';

export default function ProductsPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [editing, setEditing] = useState<Product | 'new' | null>(null);

  const params = new URLSearchParams({ page: String(page), limit: '10', sort: 'newest' });
  if (query) params.set('search', query);
  if (categoryId) params.set('categoryId', categoryId);
  const list = useApi<Paginated<Product>>(`/products?${params}`);
  const categories = useApi<Category[]>('/categories');

  useEffect(() => {
    const t = setTimeout(() => {
      setQuery(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  return (
    <>
      <PageHeader
        title="Products"
        subtitle="Catalogue, images and inventory (admin only on the API)"
        action={<Button onClick={() => setEditing('new')}>+ New product</Button>}
      />
      <Card>
        <div className="mb-4 flex flex-wrap gap-3">
          <Input placeholder="Search name or description…" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-xs" />
          <Select value={categoryId} onChange={(e) => { setCategoryId(e.target.value); setPage(1); }} className="max-w-[200px]">
            <option value="">All categories</option>
            {categories.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </div>
        <ErrorBox error={list.error} />
        {!list.data ? (
          <Loading />
        ) : list.data.data.length === 0 ? (
          <Empty>No products match.</Empty>
        ) : (
          <Table head={['', 'Product', 'Category', 'Price', 'Stock', 'Status', '']}>
            {list.data.data.map((p) => (
              <tr key={p.id} className={p.isActive ? '' : 'opacity-50'}>
                <Td>
                  {p.images[0] ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.images[0].url} alt="" className="h-10 w-10 rounded-md object-cover" />
                  ) : (
                    <div className="h-10 w-10 rounded-md bg-slate-100" />
                  )}
                </Td>
                <Td>
                  <p className="font-medium text-slate-900">{p.name}</p>
                  <p className="max-w-xs truncate text-xs text-slate-500">{p.description}</p>
                </Td>
                <Td>{p.category?.name ?? <span className="text-slate-400">—</span>}</Td>
                <Td>{money(p.price)}</Td>
                <Td>
                  <Badge tone={p.stock === 0 ? 'red' : p.stock <= 5 ? 'amber' : 'green'}>{p.stock}</Badge>
                </Td>
                <Td>{p.isActive ? <Badge tone="green">Active</Badge> : <Badge>Hidden</Badge>}</Td>
                <Td className="text-right">
                  <Button variant="secondary" size="sm" onClick={() => setEditing(p)}>Edit</Button>
                </Td>
              </tr>
            ))}
          </Table>
        )}
        {list.data && <Pagination page={page} totalPages={list.data.meta.totalPages} onChange={setPage} />}
      </Card>

      {editing && (
        <ProductModal
          product={editing === 'new' ? null : editing}
          categories={categories.data ?? []}
          onClose={() => setEditing(null)}
          onSaved={(p) => {
            list.reload();
            if (editing === 'new') setEditing(p);
          }}
        />
      )}
    </>
  );
}

function ProductModal({ product, categories, onClose, onSaved }: { product: Product | null; categories: Category[]; onClose: () => void; onSaved: (p: Product) => void }) {
  const toast = useToast();
  const [current, setCurrent] = useState(product);
  const [form, setForm] = useState({
    name: product?.name ?? '',
    description: product?.description ?? '',
    price: product ? String(product.price) : '',
    stock: product ? String(product.stock) : '0',
    categoryId: product?.categoryId ?? '',
  });
  const [delta, setDelta] = useState('10');
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function run<T>(key: string, fn: () => Promise<T>, success: string) {
    setBusy(key);
    setError(null);
    try {
      const result = await fn();
      toast('success', success);
      return result;
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError(0));
    } finally {
      setBusy(null);
    }
  }

  const accept = (p?: Product) => {
    if (!p) return;
    setCurrent(p);
    onSaved(p);
  };

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const body = {
      name: form.name,
      description: form.description,
      price: Number(form.price),
      ...(current ? {} : { stock: Number(form.stock) }),
      categoryId: form.categoryId || undefined,
    };
    accept(
      await run('save', () => api<Product>(current ? `/products/${current.id}` : '/products', { method: current ? 'PATCH' : 'POST', body }), current ? 'Product updated' : 'Product created'),
    );
  }

  return (
    <Modal open title={current ? `Edit: ${current.name}` : 'New product'} onClose={onClose} wide>
      <div className="grid gap-6 md:grid-cols-2">
        <form onSubmit={save} className="space-y-3">
          <Field label="Name"><Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label="Description"><Textarea rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Price ($)"><Input required type="number" step="0.01" min="0" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} /></Field>
            {!current && <Field label="Initial stock"><Input type="number" min="0" value={form.stock} onChange={(e) => setForm({ ...form, stock: e.target.value })} /></Field>}
          </div>
          <Field label="Category">
            <Select value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}>
              <option value="">— None —</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
          <Button type="submit" loading={busy === 'save'}>{current ? 'Save changes' : 'Create product'}</Button>
        </form>

        {current ? (
          <div className="space-y-5">
            <div>
              <p className="mb-2 text-xs font-medium text-slate-600">Inventory: <b className="text-slate-900">{current.stock}</b> in stock</p>
              <div className="flex gap-2">
                <Input type="number" value={delta} onChange={(e) => setDelta(e.target.value)} className="w-24" />
                <Button variant="secondary" loading={busy === 'stock+'} onClick={async () => accept(await run('stock+', () => api<Product>(`/products/${current.id}/stock`, { method: 'PATCH', body: { delta: Number(delta) } }), 'Stock added'))}>+ Add</Button>
                <Button variant="secondary" loading={busy === 'stock-'} onClick={async () => accept(await run('stock-', () => api<Product>(`/products/${current.id}/stock`, { method: 'PATCH', body: { delta: -Number(delta) } }), 'Stock removed'))}>− Remove</Button>
              </div>
            </div>

            <div>
              <p className="mb-2 text-xs font-medium text-slate-600">Images (JPEG/PNG/WebP, max 5 MB, checked by file signature)</p>
              <div className="flex flex-wrap gap-2">
                {current.images.map((img) => (
                  <div key={img.id} className="group relative">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={img.url} alt="" className="h-20 w-20 rounded-lg object-cover ring-1 ring-slate-200" />
                    <button
                      onClick={async () => accept(await run('img', () => api<Product>(`/products/${current.id}/images/${img.id}`, { method: 'DELETE' }), 'Image removed'))}
                      className="absolute -right-1.5 -top-1.5 hidden h-5 w-5 rounded-full bg-rose-600 text-xs text-white group-hover:block"
                      aria-label="Remove image"
                    >✕</button>
                  </div>
                ))}
                <label className="flex h-20 w-20 cursor-pointer items-center justify-center rounded-lg border-2 border-dashed border-slate-300 text-2xl text-slate-400 hover:border-indigo-400 hover:text-indigo-500">
                  {busy === 'upload' ? '…' : '+'}
                  <input
                    type="file"
                    className="hidden"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      e.target.value = '';
                      if (!file) return;
                      const fd = new FormData();
                      fd.append('file', file);
                      accept(await run('upload', () => api<Product>(`/products/${current.id}/images`, { method: 'POST', form: fd }), 'Image uploaded'));
                    }}
                  />
                </label>
              </div>
            </div>

            <div className="border-t border-slate-100 pt-4">
              {current.isActive ? (
                <Button variant="danger" loading={busy === 'hide'} onClick={async () => {
                  const ok = await run('hide', () => api(`/products/${current.id}`, { method: 'DELETE' }), 'Product hidden from the store');
                  if (ok) accept({ ...current, isActive: false });
                }}>Hide from store</Button>
              ) : (
                <Button variant="secondary" loading={busy === 'show'} onClick={async () => accept(await run('show', () => api<Product>(`/products/${current.id}`, { method: 'PATCH', body: { isActive: true } }), 'Product restored'))}>Restore to store</Button>
              )}
            </div>
          </div>
        ) : (
          <p className="text-sm text-slate-500">Create the product first, then add images and manage stock.</p>
        )}
      </div>
      <div className="mt-4"><ErrorBox error={error} /></div>
    </Modal>
  );
}
