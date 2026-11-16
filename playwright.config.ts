import { defineConfig, devices } from '@playwright/test';

// Runs the browser tests against the Vite dev server (catches dev-only module
// issues), the production build, and the app in API mode against the real API.
// Ports differ from `npm run dev` (5317) so a running dev session isn't disturbed.
// E2E_PORT_BASE moves all four, so branches in other worktrees can test at the same time.
const BASE = Number(process.env.E2E_PORT_BASE ?? 5319);
const DEV_PORT = BASE;
const PREVIEW_PORT = BASE + 1;
const API_PORT = BASE + 2;
const API_WEB_PORT = BASE + 3;

export default defineConfig({
  testDir: 'apps/web/e2e',
  fullyParallel: true,
  reporter: [['list']],
  use: {
    ...devices['Desktop Chrome'],
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'dev', testIgnore: 'api.spec.ts', use: { baseURL: `http://localhost:${DEV_PORT}` } },
    { name: 'build', testIgnore: 'api.spec.ts', use: { baseURL: `http://localhost:${PREVIEW_PORT}` } },
    { name: 'api', testMatch: 'api.spec.ts', use: { baseURL: `http://localhost:${API_WEB_PORT}` } },
  ],
  webServer: [
    {
      command: `npx vite apps/web --port ${DEV_PORT} --strictPort`,
      url: `http://localhost:${DEV_PORT}`,
      reuseExistingServer: false,
      env: { VITE_CACHE_DIR: 'node_modules/.vite-e2e' },
    },
    {
      command: `npm run build && npx vite preview apps/web --port ${PREVIEW_PORT} --strictPort`,
      url: `http://localhost:${PREVIEW_PORT}`,
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: 'npm run dev:api',
      url: `http://localhost:${API_PORT}/api/health`,
      reuseExistingServer: false,
      env: { API_PORT: String(API_PORT) },
    },
    {
      command: `npx vite apps/web --port ${API_WEB_PORT} --strictPort`,
      url: `http://localhost:${API_WEB_PORT}`,
      reuseExistingServer: false,
      env: { VITE_CACHE_DIR: 'node_modules/.vite-e2e-api', VITE_API_URL: `http://localhost:${API_PORT}/api` },
    },
  ],
});
