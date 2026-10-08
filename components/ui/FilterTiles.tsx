'use client'

import { Beads } from './Beads'
import styles from './FilterTiles.module.css'

export type TileBand = 'review' | 'monitor' | 'maintain'
const ORDER: TileBand[] = ['review', 'monitor', 'maintain']
const WORD: Record<TileBand, string> = { review: 'Review', monitor: 'Monitor', maintain: 'Maintain' }

/**
 * Findings in a scan (docs/design/array-v4-dataviz.md § B): three equal tiles,
 * count + word + beads. Tapping one filters; tapping it again clears. Zero
 * counts stay visible (and disabled) so the scale of the scan is honest.
 */
export function FilterTiles({
  counts,
  selected,
  onSelect,
  label = 'Filter findings by severity',
}: {
  counts: Record<TileBand, number>
  selected: TileBand | null
  onSelect: (band: TileBand | null) => void
  label?: string
}) {
  return (
    <div className={styles.row} role="group" aria-label={label}>
      {ORDER.map((band) => {
        const on = selected === band
        const n = counts[band]
        return (
          <button
            key={band}
            type="button"
            className={styles.tile}
            data-band={band}
            data-on={on ? 'true' : undefined}
            aria-pressed={on}
            disabled={n === 0}
            onClick={() => onSelect(on ? null : band)}
          >
            <span className={styles.count}>{n}</span>
            <span className={styles.word}>
              <Beads band={band} size={5} />
              {WORD[band]}
            </span>
          </button>
        )
      })}
    </div>
  )
}
