import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const backendPort = parseInt(process.env['E2E_BACKEND_PORT'] ?? '3000', 10);
const frontendPort = parseInt(process.env['E2E_FRONTEND_PORT'] ?? '4173', 10);
const backendBaseUrl = `http://127.0.0.1:${backendPort}`;
const frontendBaseUrl = `http://127.0.0.1:${frontendPort}`;
const databaseUrl =
  process.env['DATABASE_URL'] ??
  'postgres://openintern:openintern@127.0.0.1:5432/openintern';
const e2eDataDir = path.join(__dirname, '.tmp', 'e2e-data');

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: {
    timeout: 15_000,
  },
  fullyParallel: false,
  workers: 1,
  retries: process.env['CI'] ? 1 : 0,
  reporter: 'list',
  use: {
    baseURL: frontendBaseUrl,
    headless: true,
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'pnpm --dir .. exec tsx src/backend/server.ts',
      url: `${backendBaseUrl}/health`,
      cwd: __dirname,
      timeout: 120_000,
      reuseExistingServer: !process.env['CI'],
      env: {
        ...process.env,
        PORT: String(backendPort),
        DATABASE_URL: databaseUrl,
        DATA_DIR: e2eDataDir,
      },
    },
    {
      command: `pnpm dev --host 127.0.0.1 --port ${frontendPort}`,
      url: frontendBaseUrl,
      cwd: __dirname,
      timeout: 120_000,
      reuseExistingServer: !process.env['CI'],
      env: {
        ...process.env,
        VITE_API_PROXY_TARGET: backendBaseUrl,
        VITE_ORG_ID: process.env['E2E_ORG_ID'] ?? 'org_playwright_e2e',
        VITE_USER_ID: process.env['E2E_USER_ID'] ?? 'user_playwright_e2e',
      },
    },
  ],
});
