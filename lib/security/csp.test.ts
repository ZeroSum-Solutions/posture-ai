import { describe, expect, test } from 'vitest'
import { buildApplicationCsp } from './csp'

describe('application Content Security Policy', () => {
  test('uses a request nonce without permitting arbitrary inline or eval scripts in production', () => {
    const policy = buildApplicationCsp({
      nonce: 'request-nonce',
      nodeEnv: 'production',
      supabaseUrl: 'https://example.supabase.co',
    })

    const scriptPolicy = policy.split('; ').find((directive) => directive.startsWith('script-src'))
    expect(scriptPolicy).toBe("script-src 'self' 'nonce-request-nonce' 'strict-dynamic' 'wasm-unsafe-eval'")
    expect(scriptPolicy).not.toContain("'unsafe-inline'")
    expect(scriptPolicy).not.toContain("'unsafe-eval'")
    expect(policy).toContain("object-src 'none'")
  })

  test('permits React development eval without permitting arbitrary inline scripts', () => {
    const policy = buildApplicationCsp({
      nonce: 'request-nonce',
      nodeEnv: 'development',
      supabaseUrl: 'http://127.0.0.1:54321',
    })

    const scriptPolicy = policy.split('; ').find((directive) => directive.startsWith('script-src'))
    expect(scriptPolicy).toContain("'unsafe-eval'")
    expect(scriptPolicy).not.toContain("'unsafe-inline'")
    expect(policy).toContain('connect-src \'self\' http://127.0.0.1:54321 ws://127.0.0.1:54321')
  })
})
