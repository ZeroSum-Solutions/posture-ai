import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  cacheDir: '/tmp/claude/vitest-cache',
  test: {
    environment: 'node',
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
