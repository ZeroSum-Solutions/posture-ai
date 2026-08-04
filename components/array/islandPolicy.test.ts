import { describe, expect, it } from 'vitest'
import { activeSlotHref, islandSlots, isIslandHidden } from './islandPolicy'

describe('islandSlots', () => {
  it('offers five slots with Capture in the middle when clinical content is live', () => {
    const slots = islandSlots(true)
    expect(slots.map(slot => slot.label)).toEqual(['Today', 'Clients', 'Capture', 'Library', 'Profile'])
    expect(slots[2].kind).toBe('action')
  })

  it('drops Library rather than linking to a gated route', () => {
    const slots = islandSlots(false)
    expect(slots.map(slot => slot.href)).not.toContain('/exercises')
    expect(slots.map(slot => slot.label)).toEqual(['Today', 'Clients', 'Capture', 'Profile'])
  })

  it('keeps Capture as the only non-destination slot', () => {
    const actions = islandSlots(true).filter(slot => slot.kind === 'action')
    expect(actions).toHaveLength(1)
    expect(actions[0].href).toBe('/assessments/new')
  })
})

describe('isIslandHidden', () => {
  it.each(['/', '/privacy', '/terms'])('hides the island on the public document %s', (pathname) => {
    expect(isIslandHidden(pathname)).toBe(true)
  })

  it.each(['/auth/sign-in', '/onboarding', '/consent/abc123', '/s/tok3n'])(
    'hides the island outside the practitioner app (%s)',
    (pathname) => {
      expect(isIslandHidden(pathname)).toBe(true)
    },
  )

  it.each(['/dashboard', '/clients', '/clients/abc', '/exercises', '/settings', '/assessments/new'])(
    'shows the island on the practitioner route %s',
    (pathname) => {
      expect(isIslandHidden(pathname)).toBe(false)
    },
  )
})

describe('activeSlotHref', () => {
  const slots = islandSlots(true)

  it('lights Capture only inside the capture flow', () => {
    expect(activeSlotHref('/assessments/new', slots)).toBe('/assessments/new')
  })

  it('lights Clients for a review, which belongs to the client not the capture', () => {
    expect(activeSlotHref('/assessments/abc-123', slots)).toBe('/clients')
  })

  it('lights Library for muscles and workouts, which hang off the library', () => {
    expect(activeSlotHref('/muscles/deltoid', slots)).toBe('/exercises')
    expect(activeSlotHref('/workouts/session-1', slots)).toBe('/exercises')
  })

  it('matches nested client routes to Clients', () => {
    expect(activeSlotHref('/clients/abc/edit', slots)).toBe('/clients')
  })

  it('returns null when no slot owns the route', () => {
    expect(activeSlotHref('/dev/golden-ingest', slots)).toBeNull()
  })

  it('never returns the Library slot when clinical content is gated off', () => {
    expect(activeSlotHref('/exercises', islandSlots(false))).toBeNull()
  })
})
