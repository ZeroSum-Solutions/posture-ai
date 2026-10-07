// Array v3 token mapping (DESIGN.md › Tokens v3, spec §2). Keys and shape are
// unchanged — WorkoutPlayer/CountdownRing/RateForm read these values but do
// not own their source. Values below point directly at the canonical v3
// custom properties in /app/globals.css (not the back-compat v2 aliases, e.g.
// `--text-primary`/`--surface-glass`), so this file reads as migrated rather
// than riding the compatibility layer. `borderStrong` and `glow` have no v3
// token at their exact alpha (.2 / .4 white) and stay literal by design — they
// predate this pass and are called out here rather than silently kept.
export const workoutTheme = {
  background: 'var(--background)',
  backgroundSunken: 'var(--surface-flat)',
  surface: 'var(--glass-card)',
  surfaceWell: 'var(--overlay-hover)',
  surfaceStrong: 'var(--surface-field)',
  textPrimary: 'var(--text-1)',
  textSecondary: 'var(--text-2)',
  textMuted: 'var(--text-3)',
  border: 'var(--hairline)',
  borderStrong: 'rgba(255, 255, 255, 0.2)',
  primary: 'var(--text-2)',
  primaryStrong: 'var(--action)',
  copper: 'var(--monitor)',
  maintain: 'var(--maintain)',
  warning: 'var(--monitor)',
  danger: 'var(--review)',
  gradient: 'var(--shell-gradient)',
  glow: 'rgba(255, 255, 255, 0.4)',
  radiusControl: 'var(--r-sm)',
  radiusCard: 'var(--r-lg)',
} as const

export function colorMix(color: string, percent: number): string {
  return `color-mix(in oklab, ${color} ${percent}%, transparent)`
}
