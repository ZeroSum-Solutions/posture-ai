import { defineConfig, configDefaults } from 'vitest/config'
import path from 'path'

export default defineConfig({
  cacheDir: '/tmp/claude/vitest-cache',
  test: {
    environment: 'node',
    // scripts/testing/array-visual holds a Playwright spec, which cannot run under
    // vitest; it lives outside e2e/ so it stays out of the release e2e inventory.
    exclude: [...configDefaults.exclude, 'e2e/**', 'mobile/**', '.claude/**', 'scripts/testing/array-visual/**'],
    coverage: {
      enabled: false,
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(process.cwd(), '.'),
    },
  },
})
