/** Injection tokens for the clients each app uses to reach other services. */
export const USERS_SERVICE = 'USERS_SERVICE';
export const PRODUCTS_SERVICE = 'PRODUCTS_SERVICE';
export const ORDERS_SERVICE = 'ORDERS_SERVICE';
export const NOTIFICATIONS_SERVICE = 'NOTIFICATIONS_SERVICE';
/** RabbitMQ publisher for domain events consumed by notifications-service. */
export const EVENTS_BUS = 'EVENTS_BUS';

/**
 * Requirement 4: events go to a topic EXCHANGE, and every consumer has its own queue
 * bound to it (fan-out). One event reaches notifications AND the email worker, and a
 * slow or stopped consumer never affects the other.
 */
export const EVENTS_EXCHANGE = 'events';
export const NOTIFICATIONS_QUEUE = 'notifications.events';
/** Messages notifications-service could not process (dead-lettered, kept for inspection). */
export const NOTIFICATIONS_DLQ = 'notifications.dead';
/** The email worker: main queue, delayed-retry queue, dead-letter exchange and queue. */
export const EMAIL_QUEUE = 'email.order-created';
export const EMAIL_RETRY_QUEUE = 'email.retry';
export const EMAIL_DLX = 'email.dlx';
export const EMAIL_DLQ = 'email.dead';
export const NOTIFICATIONS_DLX = 'notifications.dlx';

/** Default internal TCP ports (overridable with <NAME>_PORT env vars). */
export const DEFAULT_PORTS = {
  users: 3001,
  products: 3002,
  orders: 3003,
  notifications: 3005,
} as const;

/** Request/response message patterns (TCP). */
export const PATTERNS = {
  health: 'health.check',
  users: {
    register: 'users.register',
    login: 'users.login',
    refresh: 'users.refresh',
    logout: 'users.logout',
    me: 'users.me',
    updateMe: 'users.update_me',
    findAll: 'users.find_all',
    findOne: 'users.find_one',
  },
  categories: {
    findAll: 'categories.find_all',
    create: 'categories.create',
    remove: 'categories.remove',
  },
  products: {
    findAll: 'products.find_all',
    findOne: 'products.find_one',
    create: 'products.create',
    update: 'products.update',
    remove: 'products.remove',
    addImage: 'products.add_image',
    removeImage: 'products.remove_image',
    updateStock: 'products.update_stock',
    /** Names and current prices for an order (stock itself lives in inventory-service). */
    forOrder: 'products.for_order',
  },
  orders: {
    create: 'orders.create',
    findAll: 'orders.find_all',
    findOne: 'orders.find_one',
    updateStatus: 'orders.update_status',
    cancel: 'orders.cancel',
    stats: 'orders.stats',
  },
  notifications: {
    findAll: 'notifications.find_all',
    markRead: 'notifications.mark_read',
    markAllRead: 'notifications.mark_all_read',
  },
} as const;

/** Fire-and-forget domain events (RabbitMQ). */
export const EVENTS = {
  userRegistered: 'user.registered',
  orderCreated: 'order.created',
  orderStatusChanged: 'order.status_changed',
  productLowStock: 'product.low_stock',
} as const;
