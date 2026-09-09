import { defineConfig, devices } from '@playwright/test'

const port = process.env.OFFLINE_TEST_PORT ?? '3187'

export default defineConfig({
  testDir: '.',
  testMatch: /browser\.playwright\.spec\.ts/,
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: { ...devices['Desktop Chrome'], baseURL: `http://127.0.0.1:${port}` },
  webServer: {
    command: 'node test-server.mjs',
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
    env: { OFFLINE_TEST_PORT: port },
  },
})
