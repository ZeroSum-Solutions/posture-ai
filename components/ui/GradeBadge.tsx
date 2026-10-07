import Icon from '@/components/array/Icon'
import { bandFromGrade, BAND_ICON, ring, tint, tone } from '@/components/array/severity'
import styles from './GradeBadge.module.css'

export type GradeBadgeProps = {
  grade: string | null | undefined
  className?: string
  'data-testid'?: string
}

/**
 * The engine letter grade in a 40px `--r-md` tinted square, with the band
 * icon at the corner. Appears once per screen header — never repeated per
 * row (DESIGN.md › 3.13).
 */
export function GradeBadge({ grade, className, 'data-testid': testId }: GradeBadgeProps) {
  const band = bandFromGrade(grade)
  const letter = grade?.trim() ? grade.trim().charAt(0).toUpperCase() : '—'
  return (
    <span
      className={[styles.badge, className].filter(Boolean).join(' ')}
      style={{ background: tint(band), boxShadow: `inset 0 0 0 1px ${ring(band)}`, color: tone(band) }}
      data-testid={testId}
    >
      <span className={styles.letter} aria-hidden="true">{letter}</span>
      <span className={styles.corner}>
        <Icon name={BAND_ICON[band]} size={11} />
      </span>
      <span className="sr-only">Grade {letter}, {band}</span>
    </span>
  )
}
