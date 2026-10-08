/**
 * "Morph from cause" (DESIGN.md › Motion rule 2): overlays grow out of the
 * control that opened them. One capture-phase pointerdown listener remembers
 * the rect of the last pressed control; an overlay that opens shortly after
 * reads it once (a single layout read at open, never in an animation frame).
 * Keyboard opens fall back to the focused element.
 */

export type OriginRect = { x: number; y: number; width: number; height: number }
export type OverlayOrigin = OriginRect | HTMLElement | null | undefined

const CONTROL = 'button, a[href], [role="button"], [role="link"], [role="tab"], summary, label'
const MAX_AGE_MS = 900

let last: { rect: OriginRect; at: number } | null = null
let installed = false

function toRect(el: Element): OriginRect {
  const r = el.getBoundingClientRect()
  return { x: r.left, y: r.top, width: r.width, height: r.height }
}

/** Installs the listener once per document (idempotent, client only). */
export function trackOverlayOrigins(): void {
  if (installed || typeof document === 'undefined') return
  installed = true
  document.addEventListener(
    'pointerdown',
    (event) => {
      const target = (event.target as Element | null)?.closest?.(CONTROL)
      if (!target) return
      last = { rect: toRect(target), at: Date.now() }
    },
    { capture: true, passive: true },
  )
}

/**
 * Resolves where an overlay should grow from: an explicit rect/element wins;
 * otherwise the control pressed in the last ~900ms; otherwise the focused
 * control (keyboard). Returns null when there is no sensible origin.
 */
export function readOverlayOrigin(explicit?: OverlayOrigin | 'none'): OriginRect | null {
  if (typeof window === 'undefined' || explicit === 'none') return null
  if (explicit && 'getBoundingClientRect' in explicit) return toRect(explicit)
  if (explicit) return explicit as OriginRect
  if (last && Date.now() - last.at < MAX_AGE_MS) return last.rect
  const focused = document.activeElement
  if (focused && focused !== document.body && focused.matches?.(CONTROL)) return toRect(focused)
  return null
}
