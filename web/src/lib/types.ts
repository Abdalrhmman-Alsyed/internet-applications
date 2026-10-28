export type Role = 'CUSTOMER' | 'ADMIN';
export type OrderStatus = 'PENDING' | 'CONFIRMED' | 'SHIPPED' | 'DELIVERED' | 'CANCELLED';

export const ORDER_STATUSES: OrderStatus[] = ['PENDING', 'CONFIRMED', 'SHIPPED', 'DELIVERED', 'CANCELLED'];

/** Mirrors the backend's allowed transitions (orders-service). */
export const NEXT_STATUSES: Record<OrderStatus, OrderStatus[]> = {
  PENDING: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['SHIPPED', 'CANCELLED'],
  SHIPPED: ['DELIVERED'],
  DELIVERED: [],
  CANCELLED: [],
};

export interface Paginated<T> {
  data: T[];
  meta: { page: number; limit: number; total: number; totalPages: number };
}

export interface User {
  id: string;
  email: string;
  name: string;
  phone: string | null;
  role: Role;
  createdAt: string;
}

export interface Category {
  id: string;
  name: string;
  slug: string;
  _count?: { products: number };
}

export interface ProductImage {
  id: string;
  url: string;
  position: number;
}

export interface Product {
  id: string;
  name: string;
  description: string;
  price: number;
  stock: number;
  isActive: boolean;
  categoryId: string | null;
  category: { id: string; name: string; slug: string } | null;
  images: ProductImage[];
  createdAt: string;
}

export interface OrderItem {
  id: string;
  productId: string;
  productName: string;
  unitPrice: number;
  quantity: number;
  subtotal: number;
}

export interface OrderHistory {
  id: string;
  status: OrderStatus;
  changedBy: string;
  note: string | null;
  createdAt: string;
}

export interface Order {
  id: string;
  userId: string;
  status: OrderStatus;
  total: number;
  shippingAddress: string;
  note: string | null;
  items: OrderItem[];
  history: OrderHistory[];
  createdAt: string;
}

export interface OrderStats {
  totalOrders: number;
  revenue: number;
  byStatus: Record<OrderStatus, number>;
  last7Days: { date: string; orders: number; revenue: number }[];
}

export interface AppNotification {
  id: string;
  audience: 'USER' | 'ADMINS';
  userId: string | null;
  type: string;
  title: string;
  body: string;
  data: Record<string, unknown> | null;
  readAt: string | null;
  createdAt: string;
}

export interface ServiceStatus {
  status: 'up' | 'down';
  latencyMs?: number;
}

export interface SystemInfo {
  gateway: { startedAt: string; uptimeSeconds: number; nodeVersion: string; memoryMb: number; environment: string };
  services: Record<string, ServiceStatus>;
  security: {
    authentication: string;
    accessTokenTtl: string;
    refreshTokenTtl: string;
    rateLimitPerMinute: number;
    authRateLimitPerMinute: number;
    maxFailedLogins: number;
    lockMinutes: number;
    passwordHashing: string;
    roles: Role[];
  };
  queue: {
    name: string;
    durable: boolean;
    consumers: number;
    pending: number;
    published: number;
    acknowledged: number;
    publishRatePerSec: number;
  } | null;
}
