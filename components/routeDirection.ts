/**
 * Best-effort navigation direction for the route-entrance transition
 * (spec §6.2: forward enters from +x, back from -x). A `popstate` event means
 * the browser's own Back/Forward control or `router.back()/forward()`; a
 * `<Link>` click or `router.push()` fires no such event. This is a decorative
 * signal only — it never gates functionality — so a listener registered once
 * at module scope is enough; no need for React state.
 */
let lastNavigationWasPopstate = false

if (typeof window !== 'undefined') {
  window.addEventListener('popstate', () => {
    lastNavigationWasPopstate = true
  })
}

/** Reads and resets the flag. Call once per pathname change. */
export function consumeNavigationDirection(): 'forward' | 'back' {
  const direction = lastNavigationWasPopstate ? 'back' : 'forward'
  lastNavigationWasPopstate = false
  return direction
}
