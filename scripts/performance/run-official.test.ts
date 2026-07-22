import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { parseSupabaseEnvironment } from './run-official.mjs'

describe('official performance orchestration boundary', () => {
  it('parses the exact required local Supabase environment without printing it', () => {
    expect(parseSupabaseEnvironment([
      'API_URL="http://127.0.0.1:54321"',
      'ANON_KEY="anon"',
      'SERVICE_ROLE_KEY="service"',
      'DB_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres"',
    ].join('\n'))).toEqual({
      API_URL: 'http://127.0.0.1:54321',
      ANON_KEY: 'anon',
      SERVICE_ROLE_KEY: 'service',
      DB_URL: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
    })
  })

  it('fails closed when any required local service value is absent', () => {
    expect(() => parseSupabaseEnvironment('API_URL="http://127.0.0.1:54321"'))
      .toThrow(/omitted ANON_KEY/)
  })

  it('gives the frozen official workload enough orchestration time on GitHub runners', () => {
    const workflow = readFileSync(new URL('../../.github/workflows/performance.yml', import.meta.url), 'utf8')
    const timeoutMinutes = Number(/timeout-minutes:\s*(\d+)/u.exec(workflow)?.[1])

    expect(timeoutMinutes).toBeGreaterThanOrEqual(90)
  })
})
