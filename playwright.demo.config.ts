import { defineConfig, devices } from '@playwright/test'

const baseURL = process.env.DEMO_BASE_URL ?? 'http://127.0.0.1:3147'
export default defineConfig({
  testDir: './demo-e2e', testMatch: 'demo-prototype.spec.ts',
  outputDir: './test-results/demo', timeout: 180_000, workers: 1,
  reporter: [['list'], ['json', { outputFile: 'test-results/demo/results.json' }]],
  use: { baseURL, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [
    { name: 'demo-desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'demo-mobile', use: { ...devices['Pixel 7'] } },
  ],
  webServer: process.env.DEMO_BASE_URL ? undefined : {
    command: 'npm run dev -- --port 3147', url: `${baseURL}/demo`, reuseExistingServer: !process.env.CI, timeout: 120_000,
  },
})
