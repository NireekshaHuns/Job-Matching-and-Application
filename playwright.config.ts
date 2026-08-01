import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright e2e config. Drives the real pages against a THROWAWAY database
 * (`E2E_DATABASE_URL`) seeded by `e2e/global-setup.ts`. The whole suite shares
 * one DB, so it runs serially (`workers: 1`) and each spec re-seeds in
 * `beforeAll` for isolation (neon-http has no transaction rollback).
 */
const PORT = 3000;
const baseURL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['html', { open: 'never' }], ['list']] : 'list',
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'pnpm build && pnpm start',
    url: baseURL,
    // Never reuse an already-running dev server: it may be bound to the real
    // dev DATABASE_URL, so tests would run against a different DB than the one
    // the seed populated. Always spawn a fresh server pinned to the test DB.
    reuseExistingServer: false,
    timeout: 180_000,
    // The app reads DATABASE_URL; point it at the throwaway e2e DB so a run can
    // never touch the dev database.
    env: { DATABASE_URL: process.env.E2E_DATABASE_URL ?? '' },
  },
});
