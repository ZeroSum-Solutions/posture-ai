import { describe, expect, it } from 'vitest'
import { shouldRenderAppAtmosphere } from './appAtmospherePolicy'

describe('shouldRenderAppAtmosphere', () => {
  it.each([
    '/',
    '/auth/sign-in',
    '/auth/update-password',
    '/onboarding',
    '/assessments/new',
    '/workouts',
    '/workouts/session-123',
  ])('disables decorative WebGL on %s', (pathname) => {
    expect(shouldRenderAppAtmosphere(pathname)).toBe(false)
  })

  it.each([
    '/dashboard',
    '/clients',
    '/clients/client-123',
    '/assessments/assessment-123',
    '/exercises',
  ])('keeps the authenticated atmosphere on %s', (pathname) => {
    expect(shouldRenderAppAtmosphere(pathname)).toBe(true)
  })
})
