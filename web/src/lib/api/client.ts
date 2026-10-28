import createClient, { type Middleware } from 'openapi-fetch';
import type { paths } from './schema';

/**
 * Typed API client generated from the backend's Swagger (npm run gen:api).
 * Paths, params and bodies are checked by TypeScript, e.g.
 *   const { data, error } = await api.GET('/api/v1/products', { params: { query: { page: 1 } } });
 */

// Browser → public gateway URL. Server components inside Docker → internal URL.
const baseUrl =
  typeof window === 'undefined'
    ? (process.env.API_INTERNAL_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000')
    : (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000');

export const api = createClient<paths>({ baseUrl });

let accessToken: string | null = null;

export function setAccessToken(token: string | null) {
  accessToken = token;
}

const authMiddleware: Middleware = {
  onRequest({ request }) {
    if (accessToken) request.headers.set('Authorization', `Bearer ${accessToken}`);
    return request;
  },
};

api.use(authMiddleware);

/** Shape of every error the API returns. */
export interface ApiError {
  success: false;
  statusCode: number;
  error: string;
  message: string | string[];
  path: string;
  method: string;
  timestamp: string;
}
