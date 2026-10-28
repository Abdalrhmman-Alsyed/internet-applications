'use client';

import { useEffect } from 'react';
import type { ApiError } from '@/lib/api';
import type { OrderStatus } from '@/lib/types';

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';
const VARIANTS: Record<Variant, string> = {
  primary: 'bg-indigo-600 text-white hover:bg-indigo-700 disabled:bg-indigo-300',
  secondary: 'bg-white text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50 disabled:text-slate-400',
  danger: 'bg-rose-600 text-white hover:bg-rose-700 disabled:bg-rose-300',
  ghost: 'text-slate-600 hover:bg-slate-100',
};

export function Button({
  variant = 'primary',
  size = 'md',
  className,
  loading,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md'; loading?: boolean }) {
  return (
    <button
      {...props}
      disabled={props.disabled || loading}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition disabled:cursor-not-allowed',
        size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-4 py-2 text-sm',
        VARIANTS[variant],
        className,
      )}
    >
      {loading && <Spinner className="h-3.5 w-3.5" />}
      {children}
    </button>
  );
}

export function Card({ title, action, className, children }: { title?: React.ReactNode; action?: React.ReactNode; className?: string; children: React.ReactNode }) {
  return (
    <section className={cx('rounded-xl border border-slate-200 bg-white shadow-sm', className)}>
      {(title || action) && (
        <header className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-3">
          <h2 className="text-sm font-semibold text-slate-800">{title}</h2>
          {action}
        </header>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
}

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

const TONES = {
  gray: 'bg-slate-100 text-slate-700',
  blue: 'bg-sky-100 text-sky-800',
  indigo: 'bg-indigo-100 text-indigo-800',
  amber: 'bg-amber-100 text-amber-800',
  green: 'bg-emerald-100 text-emerald-800',
  red: 'bg-rose-100 text-rose-800',
};
export type Tone = keyof typeof TONES;

export function Badge({ tone = 'gray', children }: { tone?: Tone; children: React.ReactNode }) {
  return <span className={cx('inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium', TONES[tone])}>{children}</span>;
}

export const STATUS_TONE: Record<OrderStatus, Tone> = {
  PENDING: 'amber',
  CONFIRMED: 'blue',
  SHIPPED: 'indigo',
  DELIVERED: 'green',
  CANCELLED: 'red',
};

export function StatusBadge({ status }: { status: OrderStatus }) {
  return <Badge tone={STATUS_TONE[status]}>{status}</Badge>;
}

export function Spinner({ className = 'h-5 w-5' }: { className?: string }) {
  return <span className={cx('inline-block animate-spin rounded-full border-2 border-current border-r-transparent', className)} />;
}

export function Loading() {
  return (
    <div className="flex justify-center py-12 text-indigo-600">
      <Spinner className="h-7 w-7" />
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="py-10 text-center text-sm text-slate-500">{children}</p>;
}

/** Shows the API's unified error body, so rejections are visible as-is. */
export function ErrorBox({ error }: { error: ApiError | null | undefined }) {
  if (!error) return null;
  return (
    <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
      <p className="font-semibold">
        {error.status || 'Network'} {error.body?.error ?? 'Error'}: {error.message}
      </p>
      {error.body && <pre className="mt-2 overflow-x-auto text-xs text-rose-700">{JSON.stringify(error.body, null, 2)}</pre>}
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-600">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-400">{hint}</span>}
    </label>
  );
}

const inputCls =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100';

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cx(inputCls, props.className)} />;
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cx(inputCls, props.className)} />;
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cx(inputCls, props.className)} />;
}

export function Modal({ open, title, onClose, children, wide }: { open: boolean; title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    if (open) window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 sm:p-10" onMouseDown={onClose}>
      <div
        className={cx('w-full rounded-xl bg-white shadow-xl', wide ? 'max-w-3xl' : 'max-w-lg')}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
          <h3 className="font-semibold text-slate-900">{title}</h3>
          <button onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Close">
            ✕
          </button>
        </header>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

export function Pagination({ page, totalPages, onChange }: { page: number; totalPages: number; onChange: (p: number) => void }) {
  if (totalPages <= 1) return null;
  return (
    <div className="mt-4 flex items-center justify-end gap-2 text-sm text-slate-600">
      <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => onChange(page - 1)}>
        ← Prev
      </Button>
      <span>
        Page {page} of {totalPages}
      </span>
      <Button variant="secondary" size="sm" disabled={page >= totalPages} onClick={() => onChange(page + 1)}>
        Next →
      </Button>
    </div>
  );
}

export function Table({ head, children }: { head: React.ReactNode[]; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
            {head.map((h, i) => (
              <th key={i} className="whitespace-nowrap px-3 py-2 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">{children}</tbody>
      </table>
    </div>
  );
}

export const Td = ({ children, className }: { children?: React.ReactNode; className?: string }) => (
  <td className={cx('px-3 py-2.5 align-middle', className)}>{children}</td>
);
