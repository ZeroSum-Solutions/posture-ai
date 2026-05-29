import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  cacheDir: '/tmp/claude/vitest-cache',
  test: {
    environment: 'node',
  },
  resolve: {
    alias: {
      '@': path.resolve(process.cwd(), '.'),
    },
  },
})
