import type { Transition } from 'framer-motion'

/**
 * Array v3 motion presets. Every transition in components/ui uses one of these;
 * see DESIGN.md › Motion. Springs are interruptible and settle in ≤450ms, except
 * the looping loader spring. Under prefers-reduced-motion, MotionConfig
 * (reducedMotion="user") drops transform animations and `reduced` replaces them.
 */
export const spring = {
  /** Press feedback: scale .97 → 1 with a small overshoot, ~160ms. */
  press: { type: 'spring', stiffness: 520, damping: 24, mass: 0.7 },
  /** Chip, toggle, tab indicator, check: ~220ms. */
  state: { type: 'spring', stiffness: 420, damping: 32, mass: 0.9 },
  /** Expand, collapse, reorder, FLIP: ~340ms. */
  layout: { type: 'spring', stiffness: 320, damping: 30, mass: 1 },
  /** Sheet present: ~380ms, no overshoot. */
  sheet: { type: 'spring', stiffness: 380, damping: 38, mass: 1 },
  /** Sheet dismiss: inherits drag velocity. */
  sheetOut: { type: 'spring', stiffness: 440, damping: 44, mass: 1 },
  /** Route enter: small x/y offset + fade. */
  page: { type: 'spring', stiffness: 340, damping: 34, mass: 0.9 },
  /** Springy loaders: visible bounce. */
  loader: { type: 'spring', stiffness: 260, damping: 14, mass: 1 },
  /** Scan complete, setup done. */
  delight: { type: 'spring', stiffness: 300, damping: 20, mass: 1 },
} as const satisfies Record<string, Transition>

export type SpringName = keyof typeof spring

/** Opacity-only fades (scrims, exits). */
export const fade = { duration: 0.16, ease: 'easeOut' } as const satisfies Transition

/** Replaces every spring under prefers-reduced-motion. */
export const reduced = { duration: 0.15, ease: 'easeOut' } as const satisfies Transition

/** Press scales by surface type. */
export const pressScale = { button: 0.97, row: 0.985, tab: 0.9 } as const

/** Stagger for list entrances: 40ms per item, capped at 6 items. */
export function stagger(index: number): number {
  return Math.min(index, 6) * 0.04
}

/** Loader timing contract: show after 300ms, stay at least 500ms. */
export const busyTiming = { delayMs: 300, minVisibleMs: 500 } as const
