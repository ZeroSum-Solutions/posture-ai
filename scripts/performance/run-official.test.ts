import { describe, expect, it } from 'vitest'
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
})
