'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import { useToast } from '@/components/toasts';
import { getTokens, WS_URL } from './api';
import { useAuth } from './auth';
import type { AppNotification } from './types';

interface RealtimeState {
  connected: boolean;
  /** Notifications received live since the page loaded (newest first). */
  live: AppNotification[];
  unreadBump: number;
}

const RealtimeContext = createContext<RealtimeState>({ connected: false, live: [], unreadBump: 0 });

/** Socket.io connection to notifications-service, authenticated with the access token. */
export function RealtimeProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const toast = useToast();
  const [state, setState] = useState<RealtimeState>({ connected: false, live: [], unreadBump: 0 });

  useEffect(() => {
    const token = getTokens()?.accessToken;
    if (!user || !token) return;
    const socket = io(WS_URL, { auth: { token }, transports: ['websocket'] });
    socket.on('connect', () => setState((s) => ({ ...s, connected: true })));
    socket.on('disconnect', () => setState((s) => ({ ...s, connected: false })));
    socket.on('notification', (n: AppNotification) => {
      setState((s) => ({ ...s, live: [n, ...s.live].slice(0, 50), unreadBump: s.unreadBump + 1 }));
      toast('info', `🔔 ${n.title}`, n.body);
    });
    return () => {
      socket.disconnect();
    };
  }, [user, toast]);

  return <RealtimeContext.Provider value={state}>{children}</RealtimeContext.Provider>;
}

export const useRealtime = () => useContext(RealtimeContext);
