import { describe, expect, it } from 'vitest'
import { isOperationalRoute, shouldAnimateRouteEntrance } from './motionOrchestratorPolicy'

describe('shouldAnimateRouteEntrance', () => {
  it.each([
    '/assessments/new',
    '/assessments/assessment-123',
    '/clients',
    '/clients/client-123',
    '/clients/client-123/edit',
  ])('keeps the operational route immediately interactive on %s', (pathname) => {
    expect(isOperationalRoute(pathname)).toBe(true)
    expect(shouldAnimateRouteEntrance(pathname)).toBe(false)
  })

  it.each([
    '/',
    '/dashboard',
    '/exercises',
    '/settings',
  ])('retains route entrance motion on %s', (pathname) => {
    expect(isOperationalRoute(pathname)).toBe(false)
    expect(shouldAnimateRouteEntrance(pathname)).toBe(true)
  })
})
