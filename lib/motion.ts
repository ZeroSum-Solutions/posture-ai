import type { Transition } from 'framer-motion'

/**
 * Array v4 motion presets — DESIGN.md › Motion. Six springs, each with one job.
 * Under prefers-reduced-motion, MotionConfig (reducedMotion="user") drops
 * transform animations and `reduced` replaces them.
 */
const v4 = {
  /** Press feedback: scale .96 → 1, lands in ~140ms with a hint of overshoot. */
  tap: { type: 'spring', stiffness: 700, damping: 32, mass: 0.5 },
  /** Chips, toggles, selection plates, markers: ~220ms. */
  snap: { type: 'spring', stiffness: 520, damping: 38, mass: 0.8 },
  /** Shape morphs: pill → sheet, row → detail, button → circle: ~380ms. */
  morph: { type: 'spring', stiffness: 340, damping: 30, mass: 1 },
  /** Pages, shared elements, sheet present: ~420ms, no overshoot. */
  glide: { type: 'spring', stiffness: 260, damping: 30, mass: 1 },
  /** Loaders, the Lens, celebration: visible wobble. */
  jelly: { type: 'spring', stiffness: 300, damping: 14, mass: 1 },
  /** Drag release: inherits gesture velocity. */
  settle: { type: 'spring', stiffness: 200, damping: 26, mass: 1 },
} as const satisfies Record<string, Transition>

export const spring = {
  ...v4,
  // v3 names, mapped onto v4 jobs.
  press: v4.tap,
  state: v4.snap,
  layout: v4.morph,
  sheet: v4.glide,
  sheetOut: { type: 'spring', stiffness: 420, damping: 42, mass: 1 },
  page: v4.glide,
  loader: v4.jelly,
  delight: v4.jelly,
} as const satisfies Record<string, Transition>

export type SpringName = keyof typeof spring

/** Content inside a morphing container: out fast, in after the shape moves. */
export const contentOut = { duration: 0.08, ease: 'easeOut' } as const satisfies Transition
export const contentIn = { duration: 0.14, delay: 0.06, ease: 'easeOut' } as const satisfies Transition

/** Opacity-only fades (scrims, exits). */
export const fade = { duration: 0.16, ease: 'easeOut' } as const satisfies Transition

/** Replaces every spring under prefers-reduced-motion. */
export const reduced = { duration: 0.12, ease: 'easeOut' } as const satisfies Transition

/** Press scales by surface type. */
export const pressScale = { button: 0.96, row: 0.985, tab: 0.9, lens: 0.88 } as const

/** Stagger for list entrances: 30ms per item, capped at 8 items. */
export function stagger(index: number): number {
  return Math.min(index, 8) * 0.03
}

/** Loader timing contract: show after 300ms, stay at least 500ms. */
export const busyTiming = { delayMs: 300, minVisibleMs: 500 } as const
