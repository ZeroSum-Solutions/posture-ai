import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const VITE_NODE = resolve('node_modules/.bin/vite-node')

function runEntry(script: string) {
  return spawnSync(VITE_NODE, ['--config', 'vitest.config.ts', script], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: { ...process.env, PERF_CLI_ENTRY_PROBE: '1' },
    timeout: 15_000,
  })
}

describe('performance CLI entrypoints', () => {
  it.each([
    ['scripts/performance/seed.ts', 'PERFORMANCE_SEED_CLI_ENTRY_OK'],
    ['scripts/performance/run-api.ts', 'PERFORMANCE_API_CLI_ENTRY_OK'],
  ])('executes %s as a real vite-node entrypoint', (script, marker) => {
    const result = runEntry(script)
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toContain(marker)
  })
})
