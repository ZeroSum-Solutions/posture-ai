import { defineConfig, devices } from '@playwright/test'

// E2E runs against `next dev` backed by the local Supabase stack
// (`npx supabase start`). Use `npm run test:e2e`, which resolves the local
// stack's URL/keys into E2E_* env vars before invoking Playwright.
const PORT = process.env.E2E_PORT ?? '3100'
const baseURL = `http://127.0.0.1:${PORT}`

const supabaseEnv = {
  NEXT_PUBLIC_SUPABASE_URL: process.env.E2E_SUPABASE_URL ?? '',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.E2E_SUPABASE_ANON_KEY ?? '',
  SUPABASE_SERVICE_ROLE_KEY: process.env.E2E_SUPABASE_SERVICE_ROLE_KEY ?? '',
  // Server-side gate for fixture scoring; never set in production.
  POSTURE_TEST_MODE_ENABLED: '1',
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
    },
    {
      name: 'mobile-webkit',
      use: { ...devices['iPhone 14'], storageState: 'e2e/.auth/user.json' },
      dependencies: ['setup'],
      testIgnore: /real-detection\.spec\.ts/, // model download + WASM detect runs on chromium only
    },
  ],
  webServer: {
    command: `npx next dev --turbopack --port ${PORT}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: supabaseEnv,
  },
})
