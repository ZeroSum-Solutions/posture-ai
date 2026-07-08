import { describe, test, expect } from 'vitest'
import { publicPaths, isPublicPath } from './public-paths'

// The proxy allowlist IS the auth boundary: a typo here either exposes every
// gated page or breaks the public share/consent links. These tests pin both
// directions.
describe('proxy public-path allowlist', () => {
  const prod = publicPaths('production')

  test('public surfaces stay reachable without auth', () => {
    for (const p of [
      '/',
      '/auth/sign-in',
      '/auth/sign-up',
      '/auth/callback?code=abc',
      '/auth/forgot-password',
      '/auth/update-password',
      '/api/health',
      '/privacy',
      '/terms',
      '/consent/some-token',
      '/api/consent/respond',
      '/s/some-share-token',
      '/api/workouts/token/some-share-token',
      '/api/workouts/token/some-share-token/rate',
    ]) {
      expect(isPublicPath(new URL(p, 'http://x').pathname, prod), `${p} should be public`).toBe(true)
    }
  })

  test('protected surfaces are NOT public', () => {
    for (const p of [
      '/dashboard',
      '/clients',
      '/clients/123',
      '/assessments/new',
      '/assessments/123',
      '/workouts/123',
      '/exercises',
      '/muscles',
      '/settings',
      '/onboarding',
      '/api/assessments',
      '/api/assessments/123',
      '/api/clients',
      '/api/workouts',
      '/api/workouts/123/run',
      '/api/workouts/123/rate',
      '/api/reports',
      '/api/settings',
      '/api/consent', // consent MINTING is practitioner-only; only /respond is public
      '/api/consent/link',
      '/api/dev/create-test-user', // never public in production builds
    ]) {
      expect(isPublicPath(p, prod), `${p} must stay auth-gated`).toBe(false)
    }
  })

  test('dev routes are allow-listed outside production only', () => {
    expect(isPublicPath('/api/dev/create-test-user', publicPaths('development'))).toBe(true)
    expect(isPublicPath('/api/dev/create-test-user', publicPaths('production'))).toBe(false)
  })

  test('no public prefix accidentally shadows a protected route family', () => {
    // Every allowlisted entry must not be a prefix of these gated roots.
    const gatedRoots = ['/dashboard', '/clients', '/assessments', '/workouts', '/exercises', '/muscles', '/settings', '/api/assessments', '/api/clients', '/api/workouts', '/api/reports', '/api/settings']
    for (const pub of prod) {
      if (pub === '/') continue
      for (const root of gatedRoots) {
        expect(root.startsWith(pub), `public "${pub}" would shadow gated "${root}"`).toBe(false)
      }
    }
  })
})
