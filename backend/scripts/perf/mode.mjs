// Requirement 3: switch the running system between "before" and "after", to show the
// difference live on the same data and the same code.
//
//   npm run perf:mode -- before   indexes dropped, Redis / ETag / replica / SQL stats /
//                                 one-call stock lookup off
//   npm run perf:mode -- after    everything back on (the normal state)
//   npm run perf:mode             show the current mode
//
// Then: npm run perf:test -- live-before   (or live-after), and npm run perf:compare -- live-before live-after
//
// ALWAYS finish with "after": the indexes belong to the Prisma migrations.
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const compose = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'docker-compose.yml');
const mode = process.argv[2];

const docker = (args, opts = {}) => execFileSync('docker', ['compose', '-f', compose, ...args], { encoding: 'utf8', ...opts }).trim();
const psql = (db, sql) => docker(['exec', '-T', 'postgres', 'psql', '-U', 'app', '-d', db, '-v', 'ON_ERROR_STOP=1', '-qAtc', sql]);

const INDEXES = {
  before: {
    orders_db: `DROP INDEX IF EXISTS "orders_status_createdAt_idx";
                DROP INDEX IF EXISTS "orders_createdAt_idx";
                CREATE INDEX IF NOT EXISTS "orders_status_idx" ON "orders"("status");`,
    products_db: `DROP INDEX IF EXISTS "products_name_trgm_idx";
                  DROP INDEX IF EXISTS "products_description_trgm_idx";`,
  },
  after: {
    orders_db: `DROP INDEX IF EXISTS "orders_status_idx";
                CREATE INDEX IF NOT EXISTS "orders_status_createdAt_idx" ON "orders"("status", "createdAt" DESC);
                CREATE INDEX IF NOT EXISTS "orders_createdAt_idx" ON "orders"("createdAt");`,
    products_db: `CREATE INDEX IF NOT EXISTS "products_name_trgm_idx" ON "products" USING GIN ("name" gin_trgm_ops);
                  CREATE INDEX IF NOT EXISTS "products_description_trgm_idx" ON "products" USING GIN ("description" gin_trgm_ops);`,
  },
};

function current() {
  const env = docker(['exec', '-T', 'orders-service', 'printenv', 'PERF_MODE']);
  const indexes = psql('orders_db', `SELECT string_agg(indexname, ', ' ORDER BY indexname) FROM pg_indexes WHERE tablename = 'orders'`);
  console.log(`PERF_MODE in the services: ${env}`);
  console.log(`indexes on orders: ${indexes}`);
}

if (!mode) {
  current();
  process.exit(0);
}
if (!INDEXES[mode]) {
  console.log('Usage: npm run perf:mode -- before | after');
  process.exit(1);
}

console.log(`Switching to "${mode}"...`);
for (const [db, sql] of Object.entries(INDEXES[mode])) {
  psql(db, sql);
  psql(db, 'ANALYZE;');
}
console.log('✔ indexes', mode === 'before' ? 'dropped (back to the old ones)' : 'created');

docker(['up', '-d', 'api-gateway', 'products-service', 'orders-service'], { env: { ...process.env, PERF_MODE: mode }, stdio: 'pipe' });
console.log(`✔ services restarted with PERF_MODE=${mode}`);

docker(['exec', '-T', 'redis', 'redis-cli', 'FLUSHALL']);
console.log('✔ Redis emptied (both modes start cold)');

for (let i = 0; i < 60; i++) {
  try {
    if ((await fetch('http://localhost:3000/api/v1/health')).ok) break;
  } catch {}
  await new Promise((r) => setTimeout(r, 1000));
}
current();
