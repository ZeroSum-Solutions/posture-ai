import styles from './Spinner.module.css'

export type SpinnerSize = 16 | 24 | 40
export type SpinnerTone = 'accent' | 'onAction' | 'muted'

export interface SpinnerProps {
  size?: SpinnerSize
  tone?: SpinnerTone
  /** Accessible name. Omit when a surrounding element already announces busy. */
  label?: string
  className?: string
}

const strokeWidth: Record<SpinnerSize, number> = { 16: 2.5, 24: 2.5, 40: 3 }

/**
 * An SVG ring whose arc rotates linearly (~0.9s/turn) while its length
 * breathes 25%↔70% of the circumference on a spring-like curve — the
 * "visible overshoot" that makes it springy rather than a generic spinner.
 * Pure CSS (no framer): a looping arc animation is cheaper driven by the
 * compositor than by a JS tick, and nothing here needs to coordinate with
 * another element. See DESIGN.md › Loaders and spec §6.1.1.
 */
export function Spinner({ size = 24, tone = 'accent', label, className }: SpinnerProps) {
  const width = strokeWidth[size]
  const radius = size / 2 - width
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className={[styles.spinner, className].filter(Boolean).join(' ')}
      role={label ? 'status' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <circle
        className={[styles.arc, styles[tone]].join(' ')}
        cx={size / 2}
        cy={size / 2}
        r={radius}
        strokeWidth={width}
        pathLength={100}
      />
    </svg>
  )
}
