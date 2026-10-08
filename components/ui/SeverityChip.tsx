import { BAND_LABEL } from '@/components/array/severity'
import { Beads } from './Beads'
import styles from './SeverityChip.module.css'

export type SeverityChipBand = 'maintain' | 'monitor' | 'review' | 'neutral'

export type SeverityChipProps = {
  band: SeverityChipBand
  size?: 'md' | 'sm'
  /** Overrides the band word (default: "Maintain" / "Monitor" / "Review" / "Not scored"). */
  label?: string
  /** Spring the beads in (first render of a result). */
  animate?: boolean
  className?: string
  'data-testid'?: string
}

/**
 * Severity, v4: ordinal beads + the band word in the band colour — no pill
 * background (DESIGN.md › Severity and data). Never colour alone: the bead
 * count and the word carry the meaning. Never render one band twice in a row.
 */
export function SeverityChip({ band, size = 'md', label, animate, className, 'data-testid': testId }: SeverityChipProps) {
  const text = label ?? BAND_LABEL[band]
  return (
    <span
      className={[styles.chip, size === 'sm' ? styles.sm : '', className].filter(Boolean).join(' ')}
      data-band={band}
      data-testid={testId}
    >
      <Beads band={band} size={size === 'sm' ? 5 : 6} animate={animate} />
      <span className={styles.label}>{text}</span>
    </span>
  )
}
