import { defineConfig, devices } from '@playwright/test'

// E2E runs against `next dev` locally (production `next start` in CI), backed
// by the local Supabase stack (`npx supabase start`). Use `npm run test:e2e`,
// which resolves the local stack's URL/keys into E2E_* env vars before
// invoking Playwright.
const PORT = process.env.E2E_PORT ?? '3100'
const baseURL = `http://127.0.0.1:${PORT}`

// These proofs mutate only the separately reviewed synthetic 55421/55422 stack.
// Keep their strict fixture guards; the ordinary CI stack is a different target.
// They remain runnable through the guarded isolated journey launcher.
const isolatedTrainingProofs = /training-(?:warmup-player|active-calibration|manual-recalibration|coaching-relationships|coach-athlete-handoff|exercise-media|session-long-name-accessibility)\.spec\.ts/
const isolatedProofIgnores = process.env.E2E_SUPABASE_URL === 'http://127.0.0.1:55421'
  ? []
  : [isolatedTrainingProofs]

// CI splits the suite across two parallel jobs/runners so a slow 3D/WebGL
// spec can't starve unrelated specs on the same single-worker, 2-vCPU
// GitHub-hosted runner (see ci.yml's `e2e` and `e2e-webgl` jobs). Every spec
// that mounts the Three.js posture-map viewer (iframe, canvas, GLB load)
// lives here; `E2E_SUITE` is unset for local runs, which always get the
// whole suite in one job as before.
// grade-display.spec.ts doesn't test the viewer, but every one of its cases
// does a full `/assessments/{id}` route load, which (since the 3D posture
// map became that page's hero) now mounts and renders it too; its 7-case
// "B and C" group was timing out from that same software-WebGL CPU cost.
const webglSpecs = /\/(?:anatomy-viewer|muscle-3d|muscle-viewer-controls|muscle-kb|assessment-flow|grade-display)\.spec\.ts$/
// Specs that wait on the viewer's own camera-settle signal, which is unreliable
// on software WebGL (#160). CI runs them as a non-blocking step of the webgl job.
const webglSettleSpecs = /\/(?:anatomy-viewer|muscle-3d|muscle-viewer-controls)\.spec\.ts$/
const E2E_SUITE = process.env.E2E_SUITE // undefined | 'main' | 'webgl' | 'webgl-settle'
const webglSuiteIgnores = E2E_SUITE === 'main'
  ? [webglSpecs]
  : E2E_SUITE === 'webgl' ? [webglSettleSpecs] : []
const nonWebglSuiteTestMatch = E2E_SUITE === 'webgl'
  ? webglSpecs
  : E2E_SUITE === 'webgl-settle' ? webglSettleSpecs : undefined

const supabaseEnv = {
  NEXT_PUBLIC_SUPABASE_URL: process.env.E2E_SUPABASE_URL ?? '',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.E2E_SUPABASE_ANON_KEY ?? '',
  SUPABASE_SERVICE_ROLE_KEY: process.env.E2E_SUPABASE_SERVICE_ROLE_KEY ?? '',
  // Server-side gate for fixture scoring; never set in production.
  POSTURE_TEST_MODE_ENABLED: '1',
  // Unreviewed muscle-KB content must render for muscle-kb/unreviewed-content/
  // a11y specs; no-op under `next dev`, required for CI's production server.
  NEXT_PUBLIC_SHOW_UNREVIEWED_CONTENT: '1',
  // Invitation and auth links are built from this origin. Unset, it falls back
  // to the production origin, which the local Auth redirect allow-list rejects
  // (GoTrue rewrites redirect_to to site_url and invite preparation fails
  // closed). The build in scripts/run-e2e.mjs inlines the same value.
  NEXT_PUBLIC_SITE_URL: baseURL,
}

export default defineConfig({
  testDir: './e2e',
  outputDir: './test-results',
  fullyParallel: false, // wizard flows share one test practitioner account
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI
    ? [
        ['github'],
        ['html', { open: 'never' }],
        ['./scripts/playwright-receipt-reporter.mjs', {
          outputFile: 'test-results/playwright-results.json',
          a11yOutputDir: 'test-results/a11y-receipts',
        }],
      ]
    : [
        ['list'],
        ['./scripts/playwright-receipt-reporter.mjs', {
          outputFile: 'test-results/playwright-results.json',
          a11yOutputDir: 'test-results/a11y-receipts',
        }],
      ],
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
      use: {
        ...devices['Desktop Chrome'],
        storageState: 'e2e/.auth/user.json',
        // GitHub-hosted runners have no GPU: recent Chromium refuses to create a
        // WebGL context in headless mode unless software rendering is explicitly
        // allowed. Without this flag the 3D posture-map canvas never reports
        // model-ready and every WebGL-dependent spec times out waiting for it.
        launchOptions: { args: ['--enable-unsafe-swiftshader'] },
      },
      dependencies: ['setup'],
      // In CI, the webgl job matches only webglSpecs and the main job ignores
      // them (nonWebglSuiteTestMatch/webglSuiteIgnores); unset locally, so a
      // plain `npm run test:e2e` still runs everything in one pass.
      testMatch: nonWebglSuiteTestMatch,
      // The real multi-person model case is WebKit-scoped: Chromium's full
      // landmarker call exceeds the product's fixed 10 s fail-closed deadline
      // on this runner. Cross-engine lifecycle recovery remains in
      // device-recovery.spec.ts.
      testIgnore: [/pixel-calibration\.spec\.ts|device-recovery-real-model\.webkit\.spec\.ts/, ...isolatedProofIgnores, ...webglSuiteIgnores],
    },
    {
      name: 'mobile-webkit',
      use: { ...devices['iPhone 14'], storageState: 'e2e/.auth/user.json' },
      dependencies: ['setup'],
      testMatch: nonWebglSuiteTestMatch,
      testIgnore: [/real-detection\.spec\.ts|capture-errors\.spec\.ts|capture-camera\.spec\.ts|capture-model-readiness\.spec\.ts|pixel-calibration\.spec\.ts/, ...isolatedProofIgnores, ...webglSuiteIgnores], // model/camera tests run on chromium only; calibration is its own project
    },
    {
      // Browser emulation proxy only: this is Pixel-style mobile Chromium
      // automation, never physical-Android or HG-04 device evidence. Keep the
      // project deliberately scoped so it does not duplicate the broad suite.
      name: 'android-chromium-proxy',
      // None of this project's specs mount the 3D viewer, so it has nothing
      // to run in the webgl job; keep it exclusively in the main job.
      testMatch: E2E_SUITE?.startsWith('webgl') ? /(?!)/ : /(?:a11y|device-accessibility-harness)\.spec\.ts/,
      use: {
        ...devices['Pixel 7'],
        storageState: 'e2e/.auth/user.json',
        launchOptions: { args: ['--enable-unsafe-swiftshader'] },
      },
      dependencies: ['setup'],
    },
    {
      // T1b: browser-lane pixel-quality calibration — writes (or, under
      // CALIBRATION_CHECK=1, verifies) lib/capture/pixel-quality.calibration.json.
      // Desktop chromium only, scoped to its one spec file so it never runs
      // inside desktop-chromium/mobile-webkit and they never run it.
      name: 'calibration',
      // Runs once: locally (suite unset) or in CI's webgl job.
      testMatch: E2E_SUITE === undefined || E2E_SUITE === 'webgl' ? /pixel-calibration\.spec\.ts/ : /(?!)/,
      use: {
        ...devices['Desktop Chrome'],
        storageState: 'e2e/.auth/user.json',
        launchOptions: { args: ['--enable-unsafe-swiftshader'] },
      },
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
