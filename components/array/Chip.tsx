import type { ReactNode } from 'react'
import Icon from './Icon'
import type { IconName } from './icons'
import { ring, tint, tone, type SeverityBand } from './severity'
import { GradeBadge as GradeBadgeV3 } from '../ui/GradeBadge'
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

/**
 * The engine letter grade, leading its row. Neutral when there is no grade.
 *
 * v3: delegates to `components/ui/GradeBadge` (DESIGN.md › 3.13 — "GradeChip
 * becomes GradeBadge"), which adds the band's icon at the corner so severity
 * is never colour alone. No call site asks for `size="lg"` today; it is kept
 * working as a 1.3× scale of the one size GradeBadge draws, rather than
 * forking a second stylesheet for a variant nothing currently uses.
 */
export function GradeChip({ grade, size = 'md' }: { grade: string | null | undefined; size?: 'md' | 'lg' }) {
  if (size === 'lg') {
    return (
      <span style={{ display: 'inline-block', transform: 'scale(1.3)', transformOrigin: 'center' }}>
        <GradeBadgeV3 grade={grade} />
      </span>
    )
  }
  return <GradeBadgeV3 grade={grade} />
}

/**
 * v3: a selected filter is an accent tint, not a white fill — white stays
 * reserved for the screen's one primary action (coordinator amendment on
 * top of DESIGN.md › 3.4). A band-coloured active filter (e.g. "Needs
 * review") keeps its own tint instead, same as before. `components/ui`'s
 * `FilterChip` covers the plain (no `band` override) case; this one stays
 * because several screens rely on the band-colour behaviour it alone has.
 */
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
    ? { background: 'var(--accent-tint)', color: 'var(--text-1)', boxShadow: 'inset 0 0 0 1px var(--accent-ring)' }
    : { background: tint(band), color: tone(band), boxShadow: `inset 0 0 0 1px ${ring(band)}` }
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={styles.filter}
      style={active
        ? activeStyle
        : { background: 'var(--surface-flat)', color: 'var(--text-2)', boxShadow: 'inset 0 0 0 1px var(--border)' }}
    >
      {active && band === 'neutral' ? <Icon name="check-linear" size={13} /> : null}
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
