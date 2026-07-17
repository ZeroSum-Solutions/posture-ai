import { defineConfig, devices } from '@playwright/test'

// E2E runs against `next dev` locally (production `next start` in CI), backed
// by the local Supabase stack (`npx supabase start`). Use `npm run test:e2e`,
// which resolves the local stack's URL/keys into E2E_* env vars before
// invoking Playwright.
const PORT = process.env.E2E_PORT ?? '3100'
const baseURL = `http://127.0.0.1:${PORT}`

const supabaseEnv = {
  NEXT_PUBLIC_SUPABASE_URL: process.env.E2E_SUPABASE_URL ?? '',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.E2E_SUPABASE_ANON_KEY ?? '',
  SUPABASE_SERVICE_ROLE_KEY: process.env.E2E_SUPABASE_SERVICE_ROLE_KEY ?? '',
  // Server-side gate for fixture scoring; never set in production.
  POSTURE_TEST_MODE_ENABLED: '1',
  // Unreviewed muscle-KB content must render for muscle-kb/unreviewed-content/
  // a11y specs; no-op under `next dev`, required for CI's production server.
  NEXT_PUBLIC_SHOW_UNREVIEWED_CONTENT: '1',
}

export default defineConfig({
  testDir: './e2e',
  outputDir: './test-results',
  fullyParallel: false, // wizard flows share one test practitioner account
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    {
      name: 'desktop-chromium',
      use: { ...devices['Desktop Chrome'], storageState: 'e2e/.auth/user.json' },
      dependencies: ['setup'],
      testIgnore: /pixel-calibration\.spec\.ts/, // dedicated `calibration` project only
    },
    {
      name: 'mobile-webkit',
      use: { ...devices['iPhone 14'], storageState: 'e2e/.auth/user.json' },
      dependencies: ['setup'],
      testIgnore: /real-detection\.spec\.ts|capture-errors\.spec\.ts|capture-camera\.spec\.ts|pixel-calibration\.spec\.ts/, // model/camera tests run on chromium only; calibration is its own project
    },
    {
      // T1b: browser-lane pixel-quality calibration — writes (or, under
      // CALIBRATION_CHECK=1, verifies) lib/capture/pixel-quality.calibration.json.
      // Desktop chromium only, scoped to its one spec file so it never runs
      // inside desktop-chromium/mobile-webkit and they never run it.
      name: 'calibration',
      testMatch: /pixel-calibration\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], storageState: 'e2e/.auth/user.json' },
      dependencies: ['setup'],
    },
  ],
  webServer: {
    // CI serves the production build (compiled in scripts/run-e2e.mjs) — dev-mode
    // lazy route compilation stalls past the per-test budget under CI load.
    command: process.env.CI
      ? `npx next start --port ${PORT}`
      : `npx next dev --turbopack --port ${PORT}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: supabaseEnv,
  },
})
