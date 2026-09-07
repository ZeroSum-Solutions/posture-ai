import type { IconName } from './icons'

export interface IslandSlot {
  href: string
  label: string
  icon: IconName
  /** `action` slots never expand into a labelled pill — Capture is the only one. */
  kind: 'destination' | 'action'
}

const TODAY: IslandSlot = { href: '/dashboard', label: 'Today', icon: 'home-smile-linear', kind: 'destination' }
const CLIENTS: IslandSlot = { href: '/clients', label: 'Clients', icon: 'users-group-rounded-linear', kind: 'destination' }
const CAPTURE: IslandSlot = { href: '/assessments/new', label: 'Capture', icon: 'scanner-linear', kind: 'action' }
const WORKOUTS: IslandSlot = { href: '/workouts', label: 'Workouts', icon: 'dumbbell-small-linear', kind: 'destination' }
const PROFILE: IslandSlot = { href: '/settings', label: 'Profile', icon: 'user-circle-linear', kind: 'destination' }

/**
 * The island's slots. Workouts is dropped when clinical content is gated off:
 * workout generation is behind that flag, and the island must never
 * offer a destination the practitioner is not entitled to open.
 */
export function islandSlots(clinicalContentEnabled: boolean): IslandSlot[] {
  return clinicalContentEnabled
    ? [TODAY, CLIENTS, CAPTURE, WORKOUTS, PROFILE]
    : [TODAY, CLIENTS, CAPTURE, PROFILE]
}

const HIDDEN_EXACT = new Set(['/', '/privacy', '/terms'])
const HIDDEN_PREFIXES = ['/auth', '/onboarding', '/consent/', '/s/']

/**
 * Marketing, auth, onboarding and the public consent/share documents carry no
 * app navigation — a client following a share link is not a practitioner.
 */
export function isIslandHidden(pathname: string): boolean {
  if (HIDDEN_EXACT.has(pathname)) return true
  return HIDDEN_PREFIXES.some(prefix => pathname.startsWith(prefix))
}

/**
 * Which slot owns the current route. Assessment review lives under the client
 * that owns it, so it lights Clients rather than the Capture action; only the
 * capture flow itself belongs to Capture.
 */
export function activeSlotHref(pathname: string, slots: IslandSlot[]): string | null {
  if (pathname.startsWith('/assessments/new')) return '/assessments/new'
  if (pathname.startsWith('/assessments')) return '/clients'
  if (pathname.startsWith('/muscles') || pathname.startsWith('/exercises')) {
    return slots.some(slot => slot.href === '/workouts') ? '/workouts' : null
  }
  const match = slots
    .filter(slot => pathname === slot.href || pathname.startsWith(`${slot.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0]
  return match?.href ?? null
}
