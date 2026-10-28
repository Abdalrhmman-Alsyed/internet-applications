'use client';

import { createContext, useCallback, useContext, useState } from 'react';

type ToastTone = 'success' | 'error' | 'info';
interface Toast {
  id: number;
  tone: ToastTone;
  title: string;
  body?: string;
}

const ToastContext = createContext<(tone: ToastTone, title: string, body?: string) => void>(() => {});

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const push = useCallback((tone: ToastTone, title: string, body?: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, tone, title, body }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 5000);
  }, []);

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-80 flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto rounded-lg border-l-4 bg-white p-3 text-sm shadow-lg ${
              t.tone === 'success' ? 'border-emerald-500' : t.tone === 'error' ? 'border-rose-500' : 'border-indigo-500'
            }`}
          >
            <p className="font-semibold text-slate-800">{t.title}</p>
            {t.body && <p className="mt-0.5 text-slate-600">{t.body}</p>}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
