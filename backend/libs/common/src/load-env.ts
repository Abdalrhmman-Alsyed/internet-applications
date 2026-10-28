import { existsSync } from 'fs';

// Local development only: load backend/.env before any module reads process.env.
// In Docker the variables come from docker-compose and no .env file exists.
// Must be the first import in every main.ts.
if (existsSync('.env')) {
  process.loadEnvFile('.env');
}
