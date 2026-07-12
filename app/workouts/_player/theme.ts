export const workoutTheme = {
  background: 'var(--background)',
  backgroundSunken: 'var(--surface)',
  surface: 'var(--glass-fill-strong)',
  surfaceWell: 'var(--glass-well)',
  surfaceStrong: 'var(--surface-strong)',
  textPrimary: 'var(--text-primary)',
  textSecondary: 'var(--text-secondary)',
  textMuted: 'var(--text-muted)',
  border: 'var(--glass-border)',
  borderStrong: 'var(--border-strong)',
  primary: 'var(--brand)',
  primaryStrong: 'var(--brand-strong)',
  copper: 'var(--brand-warm)',
  maintain: 'var(--maintain)',
  warning: 'var(--warning)',
  danger: 'var(--danger)',
  gradient: 'var(--brand-gradient)',
  glow: 'var(--brand-glow)',
  radiusControl: 'var(--radius-control)',
  radiusCard: 'var(--radius-card)',
} as const

export function colorMix(color: string, percent: number): string {
  return `color-mix(in oklab, ${color} ${percent}%, transparent)`
}
