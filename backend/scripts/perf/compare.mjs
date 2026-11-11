// Before/after table from the saved k6 results.
//   npm run perf:compare                      every run in scripts/perf/results, in order
//   npm run perf:compare -- 1-baseline 5-final  just these
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = join(dirname(fileURLToPath(import.meta.url)), 'results');
const runs = process.argv.slice(2).length
  ? process.argv.slice(2)
  : readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, '')).sort();

const rows = runs.map((name) => {
  const m = JSON.parse(readFileSync(join(dir, `${name}.json`), 'utf8')).metrics;
  const d = m.http_req_duration.values;
  return {
    run: name,
    p50: d['p(50)'],
    p95: d['p(95)'],
    p99: d['p(99)'],
    rps: m.http_reqs.values.rate,
    kb: m.data_received.values.count / m.http_reqs.values.count / 1024,
    failed: m.http_req_failed.values.rate * 100,
  };
});

const f = (n, digits = 1) => n.toFixed(digits);
console.log('| run | p50 ms | p95 ms | p99 ms | requests/s | KB/request | failed % |');
console.log('|---|---:|---:|---:|---:|---:|---:|');
for (const r of rows) console.log(`| ${r.run} | ${f(r.p50)} | ${f(r.p95)} | ${f(r.p99)} | ${f(r.rps)} | ${f(r.kb)} | ${f(r.failed, 2)} |`);

if (rows.length > 1) {
  const [a, b] = [rows[0], rows[rows.length - 1]];
  const pct = (x, y) => `${y < x ? '-' : '+'}${f((Math.abs(y - x) / x) * 100, 0)}%`;
  console.log(`\n${a.run} → ${b.run}: p95 ${pct(a.p95, b.p95)}, p99 ${pct(a.p99, b.p99)}, requests/s ×${f(b.rps / a.rps, 1)}`);
}
