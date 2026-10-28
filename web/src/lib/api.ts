export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';
export const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? 'http://localhost:3004';
const BASE = `${API_URL}/api/v1`;
const STORAGE_KEY = 'ecommerce.tokens';

/** Every error from the API has this shape (gateway HttpExceptionFilter). */
export interface ApiErrorBody {
  success: false;
  statusCode: number;
  error: string;
  message: string | string[];
  path: string;
  method: string;
  timestamp: string;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body?: ApiErrorBody,
  ) {
    const msg = body?.message;
    super(Array.isArray(msg) ? msg.join(', ') : (msg ?? `Request failed (${status})`));
  }
}

interface Tokens {
  accessToken: string;
  refreshToken: string;
}

export function getTokens(): Tokens | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Tokens) : null;
  } catch {
    return null;
  }
}

export function setTokens(tokens: Tokens | null) {
  try {
    if (tokens) localStorage.setItem(STORAGE_KEY, JSON.stringify(tokens));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* storage unavailable */
  }
}

export interface RequestOptions {
  method?: string;
  body?: unknown;
  form?: FormData;
  /** Explicit token (security lab); `null` sends no token at all. Default: the logged-in user's. */
  token?: string | null;
}

export interface RawResponse<T = unknown> {
  status: number;
  body: T;
  ms: number;
}

/** Low-level call that never throws on HTTP errors (used by the security lab). */
export async function raw<T = unknown>(path: string, opts: RequestOptions = {}): Promise<RawResponse<T>> {
  const headers: Record<string, string> = {};
  const token = opts.token === undefined ? getTokens()?.accessToken : opts.token;
  if (token) headers.Authorization = `Bearer ${token}`;
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  const started = performance.now();
  const res = await fetch(`${BASE}${path}`, {
    method: opts.method ?? 'GET',
    headers,
    body: opts.form ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
  });
  const text = await res.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    /* not JSON */
  }
  return { status: res.status, body: body as T, ms: Math.round(performance.now() - started) };
}

let refreshing: Promise<boolean> | null = null;

async function refreshTokens(): Promise<boolean> {
  const refreshToken = getTokens()?.refreshToken;
  if (!refreshToken) return false;
  const res = await raw<Tokens>('/auth/refresh', { method: 'POST', body: { refreshToken }, token: null });
  if (res.status !== 200) {
    setTokens(null);
    return false;
  }
  setTokens({ accessToken: res.body.accessToken, refreshToken: res.body.refreshToken });
  return true;
}

/** Typed call for the app: throws ApiError, refreshes the access token once on 401. */
export async function api<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  let res = await raw<T>(path, opts);
  if (res.status === 401 && opts.token === undefined && getTokens()) {
    refreshing ??= refreshTokens().finally(() => (refreshing = null));
    if (await refreshing) res = await raw<T>(path, opts);
  }
  if (res.status >= 400) throw new ApiError(res.status, res.body as ApiErrorBody);
  return res.body;
}

export const money = (n: number) => `$${n.toFixed(2)}`;
export const shortId = (id: string) => `#${id.slice(0, 8)}`;
export const dateTime = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
