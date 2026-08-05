// Array (v2) token mapping. Keys, shape, and the CSS-custom-property-string
// contract are unchanged — WorkoutPlayer/CountdownRing/RateForm read these
// values but do not own their source. Values below point at the live tokens
// in /app/globals.css; where the v1 token had no direct successor (well,
// strong border, copper accent, gradient, glow, control radius) they resolve
// to the closest live equivalent rather than a reintroduced v1 custom property.
export const workoutTheme = {
  background: 'var(--background)',
  backgroundSunken: 'var(--surface-glass)',
  surface: 'var(--surface-glass-strong)',
  surfaceWell: 'rgba(255, 255, 255, 0.06)',
  surfaceStrong: 'var(--secondary-surface)',
  textPrimary: 'var(--text-primary)',
  textSecondary: 'var(--text-secondary)',
  textMuted: 'var(--text-tertiary)',
  border: 'var(--hairline)',
  borderStrong: 'rgba(255, 255, 255, 0.2)',
  primary: 'var(--text-secondary)',
  primaryStrong: 'var(--action)',
  copper: 'var(--monitor)',
  maintain: 'var(--maintain)',
  warning: 'var(--monitor)',
  danger: 'var(--review)',
  gradient: 'var(--shell-gradient)',
  glow: 'rgba(255, 255, 255, 0.4)',
  radiusControl: 'var(--radius-sm)',
  radiusCard: 'var(--radius-card)',
} as const

export function colorMix(color: string, percent: number): string {
  return `color-mix(in oklab, ${color} ${percent}%, transparent)`
}
