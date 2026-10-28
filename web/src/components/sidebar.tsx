'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { useAuth } from '@/lib/auth';
import { useRealtime } from '@/lib/realtime';

const NAV = [
  { href: '/', label: 'Overview', icon: '📊' },
  { href: '/orders', label: 'Orders', icon: '🧾' },
  { href: '/products', label: 'Products', icon: '📦' },
  { href: '/categories', label: 'Categories', icon: '🏷️' },
  { href: '/users', label: 'Users', icon: '👥' },
  { href: '/notifications', label: 'Notifications', icon: '🔔' },
  { href: '/system', label: 'System', icon: '🖥️' },
  { href: '/security', label: 'Security lab', icon: '🛡️' },
];

export function Sidebar() {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const { connected, unreadBump } = useRealtime();
  const [open, setOpen] = useState(false);

  const links = (
    <nav className="flex flex-col gap-1">
      {NAV.map((n) => {
        const active = n.href === '/' ? pathname === '/' : pathname.startsWith(n.href);
        return (
          <Link
            key={n.href}
            href={n.href}
            onClick={() => setOpen(false)}
            className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition ${
              active ? 'bg-indigo-600 text-white' : 'text-slate-300 hover:bg-slate-800 hover:text-white'
            }`}
          >
            <span>{n.icon}</span>
            <span className="flex-1">{n.label}</span>
            {n.href === '/notifications' && unreadBump > 0 && (
              <span className="rounded-full bg-rose-500 px-1.5 text-xs text-white">{unreadBump}</span>
            )}
          </Link>
        );
      })}
    </nav>
  );

  const footer = (
    <div className="border-t border-slate-800 pt-4 text-sm">
      <p className="truncate font-medium text-white">{user?.name}</p>
      <p className="truncate text-xs text-slate-400">{user?.email}</p>
      <p className="mt-2 flex items-center gap-2 text-xs text-slate-400">
        <span className={`h-2 w-2 rounded-full ${connected ? 'bg-emerald-400' : 'bg-slate-500'}`} />
        {connected ? 'Live updates on' : 'Live updates off'}
      </p>
      <button onClick={logout} className="mt-3 w-full rounded-lg bg-slate-800 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-700">
        Sign out
      </button>
    </div>
  );

  return (
    <>
      {/* Mobile top bar */}
      <div className="sticky top-0 z-40 flex items-center justify-between bg-slate-900 px-4 py-3 text-white lg:hidden">
        <span className="font-semibold">🛒 E-Commerce Admin</span>
        <button onClick={() => setOpen(!open)} className="rounded px-2 py-1 hover:bg-slate-800" aria-label="Menu">
          ☰
        </button>
      </div>
      {open && (
        <div className="fixed inset-0 z-30 bg-slate-900 p-4 pt-16 lg:hidden">
          {links}
          <div className="mt-6">{footer}</div>
        </div>
      )}

      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col justify-between bg-slate-900 p-4 lg:flex">
        <div>
          <div className="mb-6 flex items-center gap-2 px-2 text-white">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600">🛒</span>
            <span className="font-semibold">E-Commerce Admin</span>
          </div>
          {links}
        </div>
        {footer}
      </aside>
    </>
  );
}
