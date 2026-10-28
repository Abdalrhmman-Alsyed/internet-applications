'use client';

import { useEffect, useState } from 'react';
import { Badge, Card, Empty, ErrorBox, Input, Loading, PageHeader, Pagination, Select, Table, Td } from '@/components/ui';
import { dateTime } from '@/lib/api';
import type { Paginated, Role, User } from '@/lib/types';
import { useApi } from '@/lib/use-api';

export default function UsersPage() {
  const [page, setPage] = useState(1);
  const [role, setRole] = useState<Role | ''>('');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');

  useEffect(() => {
    const t = setTimeout(() => { setQuery(search.trim()); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const params = new URLSearchParams({ page: String(page), limit: '15' });
  if (role) params.set('role', role);
  if (query) params.set('search', query);
  const list = useApi<Paginated<User>>(`/users?${params}`);

  return (
    <>
      <PageHeader title="Users" subtitle="Accounts in users-service. New sign-ups are always CUSTOMER; admins are seeded." />
      <Card>
        <div className="mb-4 flex flex-wrap gap-3">
          <Input placeholder="Search name or email…" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-xs" />
          <Select value={role} onChange={(e) => { setRole(e.target.value as Role | ''); setPage(1); }} className="max-w-[180px]">
            <option value="">All roles</option>
            <option value="CUSTOMER">Customers</option>
            <option value="ADMIN">Admins</option>
          </Select>
        </div>
        <ErrorBox error={list.error} />
        {!list.data ? <Loading /> : list.data.data.length === 0 ? <Empty>No users.</Empty> : (
          <Table head={['Name', 'Email', 'Phone', 'Role', 'Joined']}>
            {list.data.data.map((u) => (
              <tr key={u.id}>
                <Td className="font-medium">{u.name}</Td>
                <Td>{u.email}</Td>
                <Td className="text-slate-500">{u.phone ?? '—'}</Td>
                <Td><Badge tone={u.role === 'ADMIN' ? 'indigo' : 'gray'}>{u.role}</Badge></Td>
                <Td className="text-slate-500">{dateTime(u.createdAt)}</Td>
              </tr>
            ))}
          </Table>
        )}
        {list.data && <Pagination page={page} totalPages={list.data.meta.totalPages} onChange={setPage} />}
      </Card>
    </>
  );
}
