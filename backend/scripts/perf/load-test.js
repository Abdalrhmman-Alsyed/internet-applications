// k6 load test (runs inside Docker, see load-test.mjs).
// The same test is run before and after each optimisation, so the numbers compare.
//
// Mix of what real users do:
//   45%  browse the shop (product list pages, some with a category or search)
//   25%  open a product
//   15%  a customer looks at "my orders" (Ahmad has 3,000 orders)
//   15%  an admin looks at all orders by status, and the dashboard statistics
import http from 'k6/http';
import { check } from 'k6';

const BASE = __ENV.BASE ?? 'http://api-gateway:3000/api/v1';
const VUS = Number(__ENV.VUS ?? 50);
const DURATION = __ENV.DURATION ?? '60s';
const LABEL = __ENV.LABEL ?? 'run';

const ENDPOINTS = ['products_list', 'product_detail', 'my_orders', 'admin_orders', 'admin_stats'];

export const options = {
  scenarios: { users: { executor: 'constant-vus', vus: VUS, duration: DURATION } },
  summaryTrendStats: ['avg', 'p(50)', 'p(95)', 'p(99)', 'max'],
  // A threshold per endpoint makes k6 report each one separately (the limits are never hit).
  thresholds: Object.fromEntries(ENDPOINTS.map((e) => [`http_req_duration{name:${e}}`, ['p(99)<600000']])),
};

function login(email, password) {
  const res = http.post(`${BASE}/auth/login`, JSON.stringify({ email, password }), { headers: { 'Content-Type': 'application/json' } });
  if (res.status !== 200) throw new Error(`login ${email}: ${res.status} ${res.body}`);
  return res.json('accessToken');
}

export function setup() {
  const customer = login('ahmad@shop.local', 'Customer@123');
  const admin = login('admin@shop.local', 'Admin@12345');
  const products = http.get(`${BASE}/products?limit=100`).json('data').map((p) => p.id);
  const bulk = http.get(`${BASE}/products?limit=100&page=50`).json('data').map((p) => p.id);
  const categories = http.get(`${BASE}/categories`).json().map((c) => c.id);
  return { customer, admin, productIds: products.concat(bulk), categories };
}

const pick = (list) => list[Math.floor(Math.random() * list.length)];
const auth = (token) => ({ Authorization: `Bearer ${token}` });

// REVALIDATE=1: behave like a browser / app with an HTTP cache: remember each ETag and
// send it back with If-None-Match (unchanged data then comes back as an empty 304).
const REVALIDATE = __ENV.REVALIDATE === '1';
const etags = {}; // per virtual user, like one device's cache
function catalogGet(url, name) {
  const res = http.get(url, { tags: { name }, headers: REVALIDATE && etags[url] ? { 'If-None-Match': etags[url] } : {} });
  if (res.headers.Etag) etags[url] = res.headers.Etag;
  return res;
}

export default function (data) {
  const r = Math.random();
  let res;
  if (r < 0.45) {
    const page = 1 + Math.floor(Math.random() * 5);
    const extra = Math.random() < 0.3 ? `&categoryId=${pick(data.categories)}` : Math.random() < 0.15 ? '&search=lamp' : '';
    res = catalogGet(`${BASE}/products?page=${page}&limit=20${extra}`, 'products_list');
  } else if (r < 0.7) {
    res = catalogGet(`${BASE}/products/${pick(data.productIds)}`, 'product_detail');
  } else if (r < 0.85) {
    res = http.get(`${BASE}/orders?limit=20`, { headers: auth(data.customer), tags: { name: 'my_orders' } });
  } else if (r < 0.95) {
    const status = pick(['PENDING', 'CONFIRMED', 'SHIPPED']);
    res = http.get(`${BASE}/orders?status=${status}&limit=20&page=${1 + Math.floor(Math.random() * 3)}`, {
      headers: auth(data.admin),
      tags: { name: 'admin_orders' },
    });
  } else {
    res = http.get(`${BASE}/orders/stats`, { headers: auth(data.admin), tags: { name: 'admin_stats' } });
  }
  check(res, { 'status 200 or 304': (x) => x.status === 200 || x.status === 304 });
}

// Short table on screen + full JSON saved for the before/after comparison.
export function handleSummary(data) {
  const ms = (v) => (v === undefined ? '-' : v.toFixed(1).padStart(8));
  const row = (name, m) => `${name.padEnd(16)}${ms(m['p(50)'])}${ms(m['p(95)'])}${ms(m['p(99)'])}`;
  const all = data.metrics.http_req_duration.values;
  const lines = [
    `\n${LABEL}: ${VUS} virtual users for ${DURATION}`,
    `${'endpoint'.padEnd(16)}${'p50 ms'.padStart(8)}${'p95 ms'.padStart(8)}${'p99 ms'.padStart(8)}`,
    row('ALL', all),
    ...ENDPOINTS.map((e) => row(e, data.metrics[`http_req_duration{name:${e}}`]?.values ?? {})),
    `requests/s: ${data.metrics.http_reqs.values.rate.toFixed(1)}   total: ${data.metrics.http_reqs.values.count}   failed: ${(data.metrics.http_req_failed.values.rate * 100).toFixed(2)}%`,
    `downloaded: ${(data.metrics.data_received.values.count / 1024 / 1024).toFixed(1)} MB   (${(data.metrics.data_received.values.count / data.metrics.http_reqs.values.count / 1024).toFixed(1)} KB per request)`,
    '',
  ];
  return { stdout: lines.join('\n'), [`/scripts/results/${LABEL}.json`]: JSON.stringify(data, null, 2) };
}
