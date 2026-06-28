import { describe, it, expect } from 'vitest'
import { safeNextPath } from './safe-next'

describe('safeNextPath', () => {
  it('allows a same-origin absolute path', () => {
    expect(safeNextPath('/auth/update-password')).toBe('/auth/update-password')
    expect(safeNextPath('/dashboard')).toBe('/dashboard')
  })

  it('rejects protocol-relative URLs (open-redirect)', () => {
    expect(safeNextPath('//evil.com')).toBe('/dashboard')
    expect(safeNextPath('/\\evil.com')).toBe('/dashboard')
  })

  it('rejects absolute URLs to other origins', () => {
    expect(safeNextPath('https://evil.com')).toBe('/dashboard')
    expect(safeNextPath('http://evil.com/path')).toBe('/dashboard')
  })

  it('rejects non-path / missing values', () => {
    expect(safeNextPath(null)).toBe('/dashboard')
    expect(safeNextPath(undefined)).toBe('/dashboard')
    expect(safeNextPath('')).toBe('/dashboard')
    expect(safeNextPath('dashboard')).toBe('/dashboard')
  })
})
