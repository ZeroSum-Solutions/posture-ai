import { describe, expect, it } from 'vitest'

import type { SupabaseClient } from '@supabase/supabase-js'

import {
  assertSupabaseCredentialsCurrent,
  parseSupabaseStatusEnvironment,
  resolveLocalSupabaseRuntime,
} from './seed'

const STATUS = [
  'ANON_KEY="current-anon"',
  'API_URL="http://127.0.0.1:54321"',
  'DB_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres"',
  'SERVICE_ROLE_KEY="current-service"',
].join('\n')

describe('local Supabase credential resolution', () => {
  it('parses quoted status output without evaluating shell syntax', () => {
    expect(parseSupabaseStatusEnvironment(STATUS)).toMatchObject({
      ANON_KEY: 'current-anon',
      API_URL: 'http://127.0.0.1:54321',
      SERVICE_ROLE_KEY: 'current-service',
    })
    expect(() => parseSupabaseStatusEnvironment('BAD LINE')).toThrow(/malformed/)
    expect(() => parseSupabaseStatusEnvironment('ANON_KEY="one"\nANON_KEY="two"')).toThrow(/duplicate/)
  })

  it('derives keys and matching URLs from the running local stack', () => {
    const runtime = resolveLocalSupabaseRuntime({}, () => STATUS)
    expect(runtime).toEqual({
      supabaseUrl: 'http://127.0.0.1:54321',
      databaseUrl: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
      serviceRoleKey: 'current-service',
      anonKey: 'current-anon',
      credentialSource: 'supabase_status',
    })
  })

  it('fails closed when status omits either current key', () => {
    expect(() => resolveLocalSupabaseRuntime({}, () => STATUS.replace(/ANON_KEY=.*\n/, ''))).toThrow(/ANON_KEY/)
    expect(() => resolveLocalSupabaseRuntime({}, () => STATUS.replace(/SERVICE_ROLE_KEY=.*$/, ''))).toThrow(/SERVICE_ROLE_KEY/)
  })

  it('accepts only complete explicit key pairs and never calls status when complete', () => {
    expect(resolveLocalSupabaseRuntime({
      PERF_SUPABASE_SERVICE_ROLE_KEY: 'explicit-service',
      PERF_SUPABASE_ANON_KEY: 'explicit-anon',
    }, () => { throw new Error('must not be called') })).toMatchObject({
      serviceRoleKey: 'explicit-service',
      anonKey: 'explicit-anon',
      credentialSource: 'performance_env',
    })
    expect(() => resolveLocalSupabaseRuntime({
      PERF_SUPABASE_SERVICE_ROLE_KEY: 'partial',
    }, () => STATUS)).toThrow(/provide both/)
  })

  it('rejects a status-derived key paired with a different local stack URL', () => {
    expect(() => resolveLocalSupabaseRuntime({
      PERF_SUPABASE_URL: 'http://127.0.0.1:65432',
    }, () => STATUS)).toThrow(/does not match/)
    expect(() => resolveLocalSupabaseRuntime({
      PERF_DB_URL: 'postgresql://postgres:postgres@127.0.0.1:65433/postgres',
    }, () => STATUS)).toThrow(/does not match/)
  })
})

describe('live credential preflight', () => {
  function clients(serviceError: unknown, anonymousError: unknown) {
    const admin = {
      auth: { admin: { listUsers: async () => ({ error: serviceError }) } },
    } as unknown as SupabaseClient
    const anonymous = {
      from: () => ({
        select: () => ({ limit: async () => ({ error: anonymousError }) }),
      }),
    } as unknown as SupabaseClient
    return { admin, anonymous }
  }

  it('accepts a service-role and anonymous key pair verified by the live stack', async () => {
    const pair = clients(null, null)
    await expect(assertSupabaseCredentialsCurrent(pair.admin, pair.anonymous)).resolves.toBeUndefined()
  })

  it('rejects stale service-role or anonymous signatures without leaking provider details', async () => {
    for (const pair of [clients({ message: 'invalid JWT: old-secret' }, null), clients(null, { message: 'invalid JWT: old-anon' })]) {
      let message = ''
      try {
        await assertSupabaseCredentialsCurrent(pair.admin, pair.anonymous)
      } catch (error) {
        message = (error as Error).message
      }
      expect(message).toMatch(/failed verification/)
      expect(message).not.toMatch(/old-secret|old-anon|invalid JWT/)
    }
  })
})
