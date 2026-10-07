import type { IconName } from '../array/icons'

/**
 * TabBar policy — ported from components/array/islandPolicy.ts when the
 * island was replaced by the docked TabBar (spec §3.7). Behavior is
 * unchanged; components/array/islandPolicy.ts now re-exports these names so
 * IslandNav (kept until a later cleanup) still works.
 */
export interface TabSlot {
  href: string
  label: string
  icon: IconName
  /** `action` slots never expand into a labelled pill — Capture is the only one. */
  kind: 'destination' | 'action'
}

const TODAY: TabSlot = { href: '/dashboard', label: 'Today', icon: 'home-smile-linear', kind: 'destination' }
const CLIENTS: TabSlot = { href: '/clients', label: 'Clients', icon: 'users-group-rounded-linear', kind: 'destination' }
const CAPTURE: TabSlot = { href: '/assessments/new', label: 'Capture', icon: 'scanner-linear', kind: 'action' }
const WORKOUTS: TabSlot = { href: '/workouts', label: 'Workouts', icon: 'dumbbell-small-linear', kind: 'destination' }
// Accessible name stays "Profile": e2e specs (a11y.spec.ts, device-accessibility-harness.spec.ts)
// assert this exact name. The spec's "You" is the same destination (/settings).
const PROFILE: TabSlot = { href: '/settings', label: 'Profile', icon: 'user-circle-linear', kind: 'destination' }
const TRAIN: TabSlot = { href: '/train', label: 'Train', icon: 'dumbbell-small-linear', kind: 'destination' }
const MANUAL_ROUTINES: TabSlot = { href: '/workouts/manual', label: 'Routines', icon: 'clipboard-check-linear', kind: 'destination' }
const EXERCISES: TabSlot = { href: '/exercises', label: 'Exercises', icon: 'magnifer-linear', kind: 'destination' }

export type TabBarAudience = 'practitioner' | 'athlete' | 'public'

/**
 * The tab bar's slots. Workouts is dropped when clinical content is gated
 * off: workout generation is behind that flag, and the bar must never offer
 * a destination the practitioner is not entitled to open.
 */
export function tabBarSlots(clinicalContentEnabled: boolean, audience: TabBarAudience = 'practitioner'): TabSlot[] {
  if (audience === 'public') return []
  if (audience === 'athlete') return [TRAIN, MANUAL_ROUTINES, EXERCISES]
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
export function isTabBarHidden(pathname: string): boolean {
  if (HIDDEN_EXACT.has(pathname)) return true
  return HIDDEN_PREFIXES.some(prefix => pathname.startsWith(prefix))
}

const RESULTS_PAGE = /^\/assessments\/(?!new(?:\/|$))[^/]+\/?$/

/**
 * Kept for components/array/islandPolicy.ts's shim only — IslandNav's
 * scroll-reveal behavior. The v3 TabBar never hides on scroll (spec §3.7), so
 * TabBar itself does not call this.
 */
export function isTabBarScrollRevealed(pathname: string): boolean {
  return RESULTS_PAGE.test(pathname)
}

/**
 * Which slot owns the current route. Assessment review lives under the client
 * that owns it, so it lights Clients rather than the Capture action; only the
 * capture flow itself belongs to Capture.
 */
export function activeSlotHref(pathname: string, slots: TabSlot[]): string | null {
  if (pathname.startsWith('/workouts/manual')) {
    if (slots.some(slot => slot.href === '/workouts/manual')) return '/workouts/manual'
    return slots.some(slot => slot.href === '/workouts') ? '/workouts' : null
  }
  if (pathname.startsWith('/assessments/new')) return '/assessments/new'
  if (pathname.startsWith('/assessments')) return '/clients'
  if (pathname.startsWith('/exercises')) {
    if (slots.some(slot => slot.href === '/exercises')) return '/exercises'
    return slots.some(slot => slot.href === '/workouts') ? '/workouts' : null
  }
  if (pathname.startsWith('/muscles')) {
    return slots.some(slot => slot.href === '/workouts') ? '/workouts' : null
  }
  const match = slots
    .filter(slot => pathname === slot.href || pathname.startsWith(`${slot.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0]
  return match?.href ?? null
}
