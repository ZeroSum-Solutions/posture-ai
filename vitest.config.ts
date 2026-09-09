import { defineConfig, configDefaults } from 'vitest/config'
import path from 'path'

export default defineConfig({
  cacheDir: '/tmp/claude/vitest-cache',
  test: {
    environment: 'node',
    exclude: [...configDefaults.exclude, '**/*.playwright.spec.ts', 'e2e/**', 'work/**', 'mobile/**', '.claude/**'],
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
