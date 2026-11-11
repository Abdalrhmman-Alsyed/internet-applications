// Runs load-test.js with k6 in Docker (nothing to install), on the compose network.
//
//   npm run perf:test -- baseline        → scripts/perf/results/baseline.json
//   npm run perf:test -- after-indexes
//
// Every request comes from one IP (the k6 container), so the gateway's per-IP rate
// limit is raised for the duration of the test and put back afterwards.
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const label = process.argv[2] ?? 'run';
const here = dirname(fileURLToPath(import.meta.url));
const compose = join(here, '..', '..', '..', 'docker-compose.yml');
mkdirSync(join(here, 'results'), { recursive: true });

const run = (args, env = {}) => execFileSync('docker', args, { stdio: 'inherit', env: { ...process.env, ...env } });
const waitForGateway = async () => {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch('http://localhost:3000/api/v1/health')).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error('gateway did not come back');
};

run(['compose', '-f', compose, 'up', '-d', 'api-gateway'], { RATE_LIMIT: '1000000' });
await waitForGateway();
try {
  run([
    'run', '--rm', '--network', 'ecommerce_default',
    '-v', `${here}:/scripts`,
    '-e', `LABEL=${label}`,
    '-e', `VUS=${process.env.VUS ?? 50}`,
    '-e', `DURATION=${process.env.DURATION ?? '60s'}`,
    '-e', `REVALIDATE=${process.env.REVALIDATE ?? '0'}`,
    'grafana/k6:0.54.0', 'run', '--quiet', '/scripts/load-test.js',
  ]);
} finally {
  run(['compose', '-f', compose, 'up', '-d', 'api-gateway']); // back to the normal limit
}
