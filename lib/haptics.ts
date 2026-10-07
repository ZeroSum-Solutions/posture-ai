/**
 * Haptic feedback as a progressive enhancement (never the only signal).
 * Uses navigator.vibrate where available (Android Chrome). iOS Safari has no
 * official web haptics API, so this is a no-op there by design.
 */
export type HapticKind = 'tap' | 'success' | 'warn'

const patterns: Record<HapticKind, number | number[]> = {
  tap: 8,
  success: [10, 40, 10],
  warn: 20,
}

export function haptic(kind: HapticKind): void {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
  try {
    if (localStorage.getItem('pa:haptics') === 'off') return
  } catch {
    // Storage can be unavailable (private mode); haptics stay on.
  }
  navigator.vibrate?.(patterns[kind])
}
