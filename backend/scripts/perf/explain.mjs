// EXPLAIN ANALYZE of the queries requirement 3 fixed, in whatever mode the system is in.
// Run it after "npm run perf:mode -- before" and again after "... -- after" to compare plans.
//
//   npm run perf:explain
import { execFileSync } from 'node:child_process';

const psql = (db, sql) =>
  execFileSync('docker', ['compose', 'exec', '-T', 'postgres', 'psql', '-U', 'app', '-d', db, '-Atc', sql], { encoding: 'utf8' }).trim();

const ahmad = psql('users_db', `SELECT id FROM users WHERE email = 'ahmad@shop.local'`);

const QUERIES = [
  ['Admin: orders by status, newest first', 'orders_db', `SELECT * FROM orders WHERE status = 'PENDING' ORDER BY "createdAt" DESC LIMIT 20 OFFSET 40`],
  ['Dashboard: orders of the last 7 days', 'orders_db', `SELECT "createdAt", total, status FROM orders WHERE "createdAt" >= now() - interval '7 days'`],
  ['Customer: my orders (Ahmad, 3,000 orders) — already indexed before', 'orders_db', `SELECT * FROM orders WHERE "userId" = '${ahmad}' ORDER BY "createdAt" DESC LIMIT 20`],
  ['Shop: search "lamp"', 'products_db', `SELECT * FROM products WHERE "isActive" AND (name ILIKE '%lamp%' OR description ILIKE '%lamp%') ORDER BY "createdAt" DESC LIMIT 20`],
];

for (const [title, db, sql] of QUERIES) {
  const plan = psql(db, `EXPLAIN (ANALYZE, COSTS OFF) ${sql}`).split('\n');
  const lines = plan.filter((l) => /Scan|Sort Method|Rows Removed|Execution Time/.test(l)).slice(0, 5);
  console.log(`\n■ ${title}`);
  for (const l of lines) console.log(`  ${l.trim()}`);
}
console.log('\nSeq Scan = reads every row · Index Scan = jumps to the rows it needs · Sort = extra step the index avoids');
