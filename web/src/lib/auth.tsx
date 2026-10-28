'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api, getTokens, setTokens } from './api';
import type { User } from './types';

interface AuthState {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<User>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!getTokens()) {
      setLoading(false);
      return;
    }
    api<User>('/users/me')
      .then(setUser)
      .catch(() => setTokens(null))
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const res = await api<{ user: User; accessToken: string; refreshToken: string }>('/auth/login', {
      method: 'POST',
      body: { email, password },
      token: null,
    });
    setTokens({ accessToken: res.accessToken, refreshToken: res.refreshToken });
    setUser(res.user);
    return res.user;
  }, []);

  const logout = useCallback(async () => {
    await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
    setTokens(null);
    setUser(null);
  }, []);

  return <AuthContext.Provider value={{ user, loading, login, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
