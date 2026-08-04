import path from 'node:path'
import { defineConfig, devices } from '@playwright/test'

// Playwright loads this config as CJS, so __dirname is the reliable anchor.
const repoRoot = path.resolve(__dirname, '../../..')
const PORT = Number(process.env.PORT ?? 3100)
const baseURL = `http://127.0.0.1:${PORT}`

/**
 * Development-only visual harness for the Array redesign.
 *
 * Deliberately NOT under `e2e/`: that directory's spec list feeds the
 * production-readiness gate (`scripts/check-production-readiness-goal.mjs`
 * compares a live `--list` against a signed inventory), and scaffolding that
 * asserts nothing has no business inside a release artifact.
 *
 * Reuses the storage state the real `e2e/auth.setup.ts` produces, so run the
 * root config's `setup` project once first. Paths are resolved from this file
 * rather than the process cwd so the harness works from any directory. Delete
 * this whole directory when the redesign lands.
 */
export default defineConfig({
  testDir: __dirname,
  timeout: 60_000,
  reporter: [['line']],
  use: {
    ...devices['iPhone 14'],
    baseURL,
    storageState: path.join(repoRoot, 'e2e/.auth/user.json'),
  },
  webServer: {
    command: `npx next dev --port ${PORT}`,
    url: baseURL,
    reuseExistingServer: true,
    timeout: 120_000,
    cwd: repoRoot,
    // Must mirror the root config's webServer env. Legal documents resolve from
    // code fixtures only when POSTURE_TEST_MODE_ENABLED is set; without it the
    // onboarding gate reports "Legal documents are temporarily unavailable" and
    // every authenticated route redirects there instead of rendering.
    env: {
      NEXT_PUBLIC_SUPABASE_URL: process.env.E2E_SUPABASE_URL ?? '',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.E2E_SUPABASE_ANON_KEY ?? '',
      SUPABASE_SERVICE_ROLE_KEY: process.env.E2E_SUPABASE_SERVICE_ROLE_KEY ?? '',
      POSTURE_TEST_MODE_ENABLED: '1',
      NEXT_PUBLIC_SHOW_UNREVIEWED_CONTENT: '1',
    },
  },
})
