import Icon from '@/components/array/Icon'
import type { IconName } from '@/components/array/icons'
import { BAND_ICON, BAND_LABEL, ring, tint, tone } from '@/components/array/severity'
import styles from './SeverityChip.module.css'

export type SeverityChipBand = 'maintain' | 'monitor' | 'review' | 'neutral'

export type SeverityChipProps = {
  band: SeverityChipBand
  size?: 'md' | 'sm'
  /** Overrides the band word (default: "Maintain" / "Monitor" / "Review" / "Not scored"). */
  label?: string
  className?: string
  'data-testid'?: string
}

const ICON: Record<SeverityChipBand, IconName> = {
  maintain: BAND_ICON.maintain,
  monitor: BAND_ICON.monitor,
  review: BAND_ICON.review,
  neutral: BAND_ICON.neutral,
}

/**
 * Severity is never colour alone (DESIGN.md › Colour): tint (16%) + ring
 * (42%) + icon + word. 28 tall (md) / 24 (sm). Never render the same band
 * twice in one row.
 */
export function SeverityChip({ band, size = 'md', label, className, 'data-testid': testId }: SeverityChipProps) {
  const text = label ?? BAND_LABEL[band]
  return (
    <span
      className={[styles.chip, size === 'sm' ? styles.sm : '', className].filter(Boolean).join(' ')}
      style={{ background: tint(band), color: tone(band), boxShadow: `inset 0 0 0 1px ${ring(band)}` }}
      data-testid={testId}
    >
      <Icon name={ICON[band]} size={size === 'sm' ? 13 : 14} />
      {/* Not the `.t-subhead`/`.t-caption` role classes: those set their own
          `color`, which would stomp the band tone set on the chip itself. */}
      <span className={styles.label}>{text}</span>
    </span>
  )
}
