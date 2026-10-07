import { describe, expect, it } from 'vitest'
import { activeSlotHref, tabBarSlots, isTabBarHidden, isTabBarScrollRevealed } from './tabBarPolicy'

describe('tabBarSlots', () => {
  it('offers five slots with Capture in the middle when clinical content is live', () => {
    const slots = tabBarSlots(true)
    expect(slots.map(slot => slot.label)).toEqual(['Today', 'Clients', 'Capture', 'Workouts', 'Profile'])
    expect(slots[2].kind).toBe('action')
  })

  it('drops Workouts rather than linking to a gated route', () => {
    const slots = tabBarSlots(false)
    expect(slots.map(slot => slot.href)).not.toContain('/workouts')
    expect(slots.map(slot => slot.label)).toEqual(['Today', 'Clients', 'Capture', 'Profile'])
  })

  it('keeps Capture as the only non-destination slot', () => {
    const actions = tabBarSlots(true).filter(slot => slot.kind === 'action')
    expect(actions).toHaveLength(1)
    expect(actions[0].href).toBe('/assessments/new')
  })

  it('gives athletes only supported training and reference destinations', () => {
    const slots = tabBarSlots(false, 'athlete')
    expect(slots.map(slot => [slot.label, slot.href])).toEqual([
      ['Train', '/train'],
      ['Routines', '/workouts/manual'],
      ['Exercises', '/exercises'],
    ])
    expect(slots.map(slot => slot.href)).not.toEqual(expect.arrayContaining(['/clients', '/assessments/new', '/settings']))
  })

  it('renders no application destinations before an actor is established', () => {
    expect(tabBarSlots(true, 'public')).toEqual([])
  })
})

describe('isTabBarHidden', () => {
  it.each(['/', '/privacy', '/terms'])('hides the tab bar on the public document %s', (pathname) => {
    expect(isTabBarHidden(pathname)).toBe(true)
  })

  it.each(['/auth/sign-in', '/onboarding', '/consent/abc123', '/s/tok3n'])(
    'hides the tab bar outside the practitioner app (%s)',
    (pathname) => {
      expect(isTabBarHidden(pathname)).toBe(true)
    },
  )

  it.each(['/dashboard', '/clients', '/clients/abc', '/exercises', '/settings', '/assessments/new'])(
    'shows the tab bar on the practitioner route %s',
    (pathname) => {
      expect(isTabBarHidden(pathname)).toBe(false)
    },
  )
})

describe('isTabBarScrollRevealed (kept for the islandPolicy shim)', () => {
  it.each(['/assessments/abc-123', '/assessments/abc-123/'])('flags the results page %s', (pathname) => {
    expect(isTabBarScrollRevealed(pathname)).toBe(true)
  })

  it.each(['/assessments/new', '/assessments/new/review', '/assessments', '/clients/abc', '/dashboard'])(
    'does not flag %s',
    (pathname) => {
      expect(isTabBarScrollRevealed(pathname)).toBe(false)
    },
  )
})

describe('activeSlotHref', () => {
  const slots = tabBarSlots(true)

  it('lights Capture only inside the capture flow', () => {
    expect(activeSlotHref('/assessments/new', slots)).toBe('/assessments/new')
  })

  it('lights Clients for a review, which belongs to the client not the capture', () => {
    expect(activeSlotHref('/assessments/abc-123', slots)).toBe('/clients')
  })

  it('lights Workouts for the exercise library, muscles and guided sessions', () => {
    expect(activeSlotHref('/muscles/deltoid', slots)).toBe('/workouts')
    expect(activeSlotHref('/workouts/session-1', slots)).toBe('/workouts')
  })

  it('keeps athlete manual and exercise routes active within their own destinations', () => {
    const athleteSlots = tabBarSlots(false, 'athlete')
    expect(activeSlotHref('/workouts/manual/54000000-0000-4000-8000-000000000004', athleteSlots)).toBe('/workouts/manual')
    expect(activeSlotHref('/exercises', athleteSlots)).toBe('/exercises')
    expect(activeSlotHref('/train', athleteSlots)).toBe('/train')
  })

  it('matches nested client routes to Clients', () => {
    expect(activeSlotHref('/clients/abc/edit', slots)).toBe('/clients')
  })

  it('returns null when no slot owns the route', () => {
    expect(activeSlotHref('/dev/golden-ingest', slots)).toBeNull()
  })

  it('never returns the Workouts slot when clinical content is gated off', () => {
    expect(activeSlotHref('/exercises', tabBarSlots(false))).toBeNull()
  })
})
