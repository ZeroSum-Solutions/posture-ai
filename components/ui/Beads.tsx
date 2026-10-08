import styles from './Beads.module.css'

export type BeadBand = 'maintain' | 'monitor' | 'review' | 'neutral'

const FILLED: Record<BeadBand, number> = { maintain: 1, monitor: 2, review: 3, neutral: 0 }

/**
 * Ordinal severity beads (DESIGN.md › Severity and data): 1 filled = Maintain,
 * 2 = Monitor, 3 = Review, in the band colour. Decorative — always render the
 * band word beside it. `animate` springs the filled beads in one by one.
 */
export function Beads({ band, size = 6, animate = false, className }: { band: BeadBand; size?: number; animate?: boolean; className?: string }) {
  const filled = FILLED[band]
  return (
    <span
      className={[styles.beads, className].filter(Boolean).join(' ')}
      data-band={band}
      data-animate={animate ? 'true' : undefined}
      style={{ '--bead': `${size}px` } as React.CSSProperties}
      aria-hidden="true"
    >
      {[0, 1, 2].map((i) => (
        <span key={i} className={styles.bead} data-on={i < filled ? 'true' : undefined} style={{ '--i': i } as React.CSSProperties} />
      ))}
    </span>
  )
}
