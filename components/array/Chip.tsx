import type { ReactNode } from 'react'
import Icon from './Icon'
import type { IconName } from './icons'
import { bandFromGrade, ring, tint, tone, type SeverityBand } from './severity'
import styles from './Chip.module.css'

/** A 16%-tint chip with a 42% ring. The system's only coloured container. */
export function Chip({
  band,
  icon,
  children,
  size = 'md',
}: {
  band: SeverityBand
  icon?: IconName
  children: ReactNode
  size?: 'md' | 'sm'
}) {
  return (
    <span
      className={[styles.chip, size === 'sm' ? styles.chipSm : ''].filter(Boolean).join(' ')}
      style={{ background: tint(band), color: tone(band), boxShadow: `inset 0 0 0 1px ${ring(band)}` }}
    >
      {icon ? <Icon name={icon} size={13} /> : null}
      {children}
    </span>
  )
}

/**
 * A signed change against the previous scan. Carries its own arrow and reads
 * emerald when the deviation moved toward zero — direction alone never colours.
 */
export function DeltaChip({
  band,
  icon,
  children,
}: {
  band: SeverityBand
  icon: IconName
  children: ReactNode
}) {
  return (
    <span
      className="n"
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 2,
        fontSize: 12, fontWeight: 500, color: tone(band), whiteSpace: 'nowrap',
      }}
    >
      <Icon name={icon} size={12} />
      {children}
    </span>
  )
}

/** The engine letter grade, leading its row. Neutral when there is no grade. */
export function GradeChip({ grade, size = 'md' }: { grade: string | null | undefined; size?: 'md' | 'lg' }) {
  const band = bandFromGrade(grade)
  return (
    <span
      className={[styles.grade, size === 'lg' ? styles.gradeLg : ''].filter(Boolean).join(' ')}
      style={{ background: tint(band), boxShadow: `inset 0 0 0 1px ${ring(band)}`, color: tone(band) }}
    >
      {grade?.trim() ? grade : '—'}
    </span>
  )
}

export function FilterChip({
  label,
  count,
  active,
  band = 'neutral',
  onClick,
}: {
  label: string
  count?: number
  active: boolean
  /** An active filter that itself denotes severity keeps its band colour. */
  band?: SeverityBand
  onClick: () => void
}) {
  const activeStyle = band === 'neutral'
    ? { background: '#fff', color: '#000', boxShadow: 'none' }
    : { background: tint(band), color: tone(band), boxShadow: `inset 0 0 0 1px ${ring(band)}` }
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={styles.filter}
      style={active
        ? activeStyle
        : { background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.75)', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.14)' }}
    >
      {label}
      {count == null ? null : <span className={styles.filterCount}>{count}</span>}
    </button>
  )
}

export function FilterRow({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div className={styles.filterRow} role="group" aria-label={label}>
      {children}
    </div>
  )
}
