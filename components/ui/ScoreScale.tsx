import { SlotNumber } from './SlotNumber'
import styles from './ScoreScale.module.css'

export type ScoreBand = 'maintain' | 'monitor' | 'review'

/** Engine grade bands folded into the three screening bands: S–B ≤20, C ≤55, D–E. */
export const SCORE_CUTOFFS = { maintainMax: 20, monitorMax: 55 } as const

export function scoreBand(score: number): ScoreBand {
  if (score <= SCORE_CUTOFFS.maintainMax) return 'maintain'
  if (score <= SCORE_CUTOFFS.monitorMax) return 'monitor'
  return 'review'
}

const WORD: Record<ScoreBand, string> = { maintain: 'Maintain', monitor: 'Monitor', review: 'Review' }

/**
 * Deviation score, v4 (docs/design/array-v4-dataviz.md § C): hero numeral with
 * a slot reveal, and a full-width 0–100 linear scale with the bands' numeric
 * cutoffs printed and one volt marker at the recorded value. Position, not
 * angle, carries the quantity; the band word is printed, not implied.
 */
export function ScoreScale({
  score,
  label = 'Deviation score',
  previous,
  compact = false,
  className,
}: {
  score: number
  label?: string
  /** Earlier comparable score, printed as text ("was 31 · 14 Sep"). */
  previous?: { score: number; date: string }
  compact?: boolean
  className?: string
}) {
  const band = scoreBand(score)
  const pct = Math.max(0, Math.min(100, score))
  const { maintainMax, monitorMax } = SCORE_CUTOFFS
  return (
    <figure className={[styles.root, compact ? styles.compact : '', className].filter(Boolean).join(' ')} data-band={band}>
      <figcaption className={styles.head}>
        <span className="t-micro">{label}</span>
      </figcaption>
      <div className={styles.valueRow}>
        <SlotNumber value={Math.round(score)} className={styles.value} />
        <span className={styles.of}>/100</span>
        <span className={styles.bandWord}>{WORD[band]}</span>
      </div>
      {previous ? (
        <p className={styles.previous}>
          was <span className="n">{Math.round(previous.score)}</span> · {previous.date}
        </p>
      ) : null}
      <div className={styles.scale} role="img" aria-label={`${Math.round(score)} on a 0 to 100 scale. Maintain 0–${maintainMax}, Monitor ${maintainMax + 1}–${monitorMax}, Review ${monitorMax + 1}–100.`}>
        <div className={styles.track}>
          <span className={`${styles.zone} ${styles.zMaintain}`} style={{ width: `${maintainMax}%` }} />
          <span className={`${styles.zone} ${styles.zMonitor}`} style={{ width: `${monitorMax - maintainMax}%` }} />
          <span className={`${styles.zone} ${styles.zReview}`} style={{ width: `${100 - monitorMax}%` }} />
        </div>
        <span className={styles.marker} style={{ left: `${pct}%` }} />
        <div className={styles.ticks} aria-hidden="true">
          <span style={{ left: '0%' }}>0</span>
          <span style={{ left: `${maintainMax}%` }}>{maintainMax}</span>
          <span style={{ left: `${monitorMax}%` }}>{monitorMax}</span>
          <span style={{ left: '100%' }}>100</span>
        </div>
      </div>
    </figure>
  )
}
