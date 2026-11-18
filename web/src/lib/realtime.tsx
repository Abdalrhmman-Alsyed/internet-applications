'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { useToast } from '@/components/toasts';
import { getTokens, WS_URL } from './api';
import { useAuth } from './auth';
import type { AppNotification } from './types';

/** Answer of the server to a channel subscription (it checks identity and permission first). */
export type SubscribeAnswer = { ok: true; channel: string } | { ok: false; status: number; message: string };

/** A new order pushed on the admin channel. */
export interface LiveOrder {
  orderId: string;
  userId: string;
  customerEmail: string;
  total: number;
  itemsCount: number;
  status: string;
  createdAt: string;
}

/** A status change pushed on an order channel (and on the admin channel). */
export interface LiveStatus {
  orderId: string;
  from: string;
  to: string;
  at: string;
}

interface RealtimeState {
  connected: boolean;
  /** Notifications received live since the page loaded (newest first). */
  live: AppNotification[];
  unreadBump: number;
  /** Requirement 4: admin channel ("admin.orders") */
  adminChannel: 'off' | 'subscribed' | 'refused';
  newOrders: LiveOrder[];
  orderBump: number;
}

const RealtimeContext = createContext<RealtimeState>({
  connected: false,
  live: [],
  unreadBump: 0,
  adminChannel: 'off',
  newOrders: [],
  orderBump: 0,
});

/**
 * Socket.io connection to notifications-service, authenticated with the access token.
 * Admins also subscribe to the admin channel: new orders and status changes arrive live.
 */
export function RealtimeProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const toast = useToast();
  const [state, setState] = useState<RealtimeState>({ connected: false, live: [], unreadBump: 0, adminChannel: 'off', newOrders: [], orderBump: 0 });

  useEffect(() => {
    const token = getTokens()?.accessToken;
    if (!user || !token) return;
    const socket = io(WS_URL, { auth: { token }, transports: ['websocket'] });
    socket.on('connect', () => {
      setState((s) => ({ ...s, connected: true }));
      if (user.role === 'ADMIN') {
        socket.emit('subscribe', { channel: 'admin.orders' }, (a: SubscribeAnswer) =>
          setState((s) => ({ ...s, adminChannel: a.ok ? 'subscribed' : 'refused' })),
        );
      }
    });
    socket.on('disconnect', () => setState((s) => ({ ...s, connected: false })));
    socket.on('notification', (n: AppNotification) => {
      setState((s) => ({ ...s, live: [n, ...s.live].slice(0, 50), unreadBump: s.unreadBump + 1 }));
      toast('info', `🔔 ${n.title}`, n.body);
    });
    socket.on('order.created', (o: LiveOrder) =>
      setState((s) => ({ ...s, newOrders: [o, ...s.newOrders].slice(0, 20), orderBump: s.orderBump + 1 })),
    );
    socket.on('order.status', () => setState((s) => ({ ...s, orderBump: s.orderBump + 1 })));
    return () => {
      socket.disconnect();
    };
  }, [user, toast]);

  return <RealtimeContext.Provider value={state}>{children}</RealtimeContext.Provider>;
}

export const useRealtime = () => useContext(RealtimeContext);

/**
 * Follows ONE order live (customer tracking page). The server checks that the order
 * belongs to the caller before joining the channel; otherwise the answer is a 403.
 */
export function useOrderChannel(orderId: string | null, onStatus: (s: LiveStatus) => void) {
  const [answer, setAnswer] = useState<SubscribeAnswer | null>(null);
  const [connected, setConnected] = useState(false);
  const handler = useCallback(onStatus, [onStatus]);

  useEffect(() => {
    const token = getTokens()?.accessToken;
    if (!orderId || !token) return;
    const socket: Socket = io(WS_URL, { auth: { token }, transports: ['websocket'] });
    socket.on('connect', () => {
      setConnected(true);
      socket.emit('subscribe', { channel: 'order', orderId }, (a: SubscribeAnswer) => setAnswer(a));
    });
    socket.on('disconnect', () => setConnected(false));
    socket.on('order.status', (s: LiveStatus) => {
      if (s.orderId === orderId) handler(s);
    });
    return () => {
      socket.disconnect();
    };
  }, [orderId, handler]);

  return { answer, connected };
}
