export enum Role {
  CUSTOMER = 'CUSTOMER',
  ADMIN = 'ADMIN',
}

export enum OrderStatus {
  PENDING = 'PENDING',
  CONFIRMED = 'CONFIRMED',
  SHIPPED = 'SHIPPED',
  DELIVERED = 'DELIVERED',
  CANCELLED = 'CANCELLED',
}

/** Claims carried by the access token. */
export interface JwtPayload {
  sub: string;
  email: string;
  role: Role;
}

/** The authenticated caller, forwarded by the gateway to every service call. */
export interface AuthUser {
  id: string;
  email: string;
  role: Role;
}

export interface Paginated<T> {
  data: T[];
  meta: { page: number; limit: number; total: number; totalPages: number };
}

export function paginate<T>(data: T[], total: number, page: number, limit: number): Paginated<T> {
  return { data, meta: { page, limit, total, totalPages: Math.ceil(total / limit) } };
}

// ─── Event payloads ───
export interface UserRegisteredEvent {
  userId: string;
  name: string;
  email: string;
}

export interface OrderCreatedEvent {
  orderId: string;
  userId: string;
  total: number;
  itemsCount: number;
}

export interface OrderStatusChangedEvent {
  orderId: string;
  userId: string;
  from: OrderStatus;
  to: OrderStatus;
}

export interface ProductLowStockEvent {
  productId: string;
  name: string;
  stock: number;
}
