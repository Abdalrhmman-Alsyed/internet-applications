'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from './api';

/** Fetches `path` and re-fetches when it changes; `reload()` forces a refresh. */
export function useApi<T>(path: string | null, intervalMs?: number) {
  const [data, setData] = useState<T | undefined>();
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (!path) return;
    let cancelled = false;
    setLoading(true);
    api<T>(path)
      .then((d) => {
        if (cancelled) return;
        setData(d);
        setError(null);
      })
      .catch((e) => !cancelled && setError(e instanceof ApiError ? e : new ApiError(0)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [path, tick]);

  useEffect(() => {
    if (!intervalMs) return;
    const id = setInterval(reload, intervalMs);
    return () => clearInterval(id);
  }, [intervalMs, reload]);

  return { data, error, loading, reload, setData };
}
