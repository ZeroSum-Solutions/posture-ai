import { describe, test, it, expect } from 'vitest'
import {
  classifyAuthPath,
  isAal1CorridorPath,
  isPublicPath,
  publicPaths,
} from './public-paths'

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
      '/auth/confirm',
      '/auth/forgot-password',
      '/auth/update-password',
      '/api/health',
      '/api/internal/privacy-maintenance',
      '/api/legal/documents?kind=terms',
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

  test('AAL1 corridor is authenticated but does not require active AAL2 admission', () => {
    for (const p of [
      '/auth/accept-invite',
      '/train/accept-invite',
      '/auth/mfa',
      '/api/auth/complete-invitation',
      '/api/training/auth/complete-invitation',
      '/api/auth/sign-out',
    ]) {
      expect(isPublicPath(p, prod), `${p} must not be public`).toBe(false)
      expect(isAal1CorridorPath(p), `${p} should be in the AAL1 corridor`).toBe(true)
      expect(classifyAuthPath(p, 'production')).toBe('aal1-corridor')
    }
  })

  test('classifies all other application and API routes as protected', () => {
    for (const p of ['/dashboard', '/onboarding', '/api/clients', '/api/settings/organization']) {
      expect(classifyAuthPath(p, 'production')).toBe('protected')
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
      '/api/legal/accept',
      '/api/dev/create-test-user', // never public in production builds
      '/api/internal/privacy-maintenance-export',
    ]) {
      expect(isPublicPath(p, prod), `${p} must stay auth-gated`).toBe(false)
    }
  })

  test('dev routes are allow-listed outside production only', () => {
    expect(isPublicPath('/api/dev/create-test-user', publicPaths('development'))).toBe(true)
    expect(isPublicPath('/api/dev/create-test-user', publicPaths('production'))).toBe(false)
  })

  test('public and corridor matches are segment-anchored', () => {
    for (const p of [
      '/auth/sign-in-admin',
      '/auth/confirm-malicious',
      '/auth/mfa-export',
      '/api/auth/sign-out-everyone',
      '/consenter',
    ]) {
      expect(classifyAuthPath(p, 'production')).toBe('protected')
    }
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

// AI generation belongs to the authenticated original workout workflow.
describe('original workout and model asset boundaries', () => {
  it.each(['/api/workouts/preview', '/api/workouts', '/api/demo/workouts/generate'])(
    'keeps %s protected', (pathname) => {
      expect(classifyAuthPath(pathname, 'production')).toBe('protected')
    },
  )
  it('allows an exact pose runtime asset without opening neighboring routes', () => {
    expect(classifyAuthPath('/mediapipe/wasm/vision_wasm_internal.wasm', 'production')).toBe('public')
    expect(classifyAuthPath('/mediapipe/wasm/vision_wasm_internal.wasm/admin', 'production')).toBe('protected')
  })
})
