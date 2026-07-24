import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveTrustClock } from './golden-repeatability'

const ROOT = resolve(__dirname, '..')

describe('Tier B v2 repeatability CLI', () => {
  it('uses wall time for production and permits explicit fixture time only', () => {
    expect(resolveTrustClock(
      'production',
      null,
      '2026-07-24T12:34:56.000Z',
    )).toBe('2026-07-24T12:34:56.000Z')
    expect(() => resolveTrustClock(
      'production',
      '2020-01-01T00:00:00.000Z',
      '2026-07-24T12:34:56.000Z',
    )).toThrow(/fixture-only/)
    expect(resolveTrustClock(
      'fixture',
      '2020-01-01T00:00:00.000Z',
      '2026-07-24T12:34:56.000Z',
    )).toBe('2020-01-01T00:00:00.000Z')
  })

  it('fails closed without an authorized chain and never reports empty success', () => {
    const result = spawnSync(
      resolve(ROOT, 'node_modules/.bin/vite-node'),
      ['scripts/golden-repeatability.ts'],
      {
        cwd: ROOT,
        encoding: 'utf8',
        env: {
          ...process.env,
          VITEST: '',
        },
      },
    )

    expect(result.status).toBe(2)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('--chain is required')
  })
})
