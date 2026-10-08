import type { ReactNode } from 'react'
import { SeverityChip, type SeverityChipBand } from './SeverityChip'
import styles from './FindingReadout.module.css'

export type FindingScale = {
  /** Upper edge of Maintain and of Monitor, in the value's unit. */
  warn: number
  danger: number
  /** Right edge of the drawn scale; defaults to danger × 1.5. */
  max?: number
}

/**
 * One finding as a readout (docs/design/array-v4-dataviz.md § A): name, the
 * recorded value with its unit, the band as beads + word, and — when the
 * measure has a finite range — a 16px threshold scale with printed cutoffs and
 * one marker for this scan. History is text ("was 2.8° · 14 Sep"), not ghost
 * markers. The whole row can be a button/link via `as`/`href` wrappers upstream.
 */
export function FindingReadout({
  name,
  value,
  unit,
  band,
  scale,
  previous,
  trailing,
  meta,
  animate,
}: {
  name: string
  value: number | null
  unit: string
  band: SeverityChipBand
  scale?: FindingScale
  previous?: { value: number; date: string }
  trailing?: ReactNode
  meta?: ReactNode
  animate?: boolean
}) {
  const fmt = (v: number) => (Math.abs(v) >= 10 ? v.toFixed(0) : v.toFixed(1))
  const max = scale ? scale.max ?? scale.danger * 1.5 : 0
  const pos = (v: number) => `${Math.max(0, Math.min(100, (Math.abs(v) / max) * 100))}%`
  const delta = previous && value != null ? value - previous.value : null
  return (
    <div className={styles.root} data-band={band}>
      <div className={styles.top}>
        <div className={styles.text}>
          <span className={styles.name}>{name}</span>
          <SeverityChip band={band} size="sm" animate={animate} />
        </div>
        <div className={styles.valueBox}>
          {value == null ? (
            <span className={styles.noValue}>No reliable reading</span>
          ) : (
            <span className={styles.value}>
              {fmt(value)}
              <span className={styles.unit}>{unit}</span>
            </span>
          )}
          {previous && delta != null ? (
            <span className={styles.prev}>
              {delta === 0 ? '=' : delta > 0 ? '↑' : '↓'} was {fmt(previous.value)}{unit} · {previous.date}
            </span>
          ) : null}
        </div>
        {trailing}
      </div>
      {scale && value != null ? (
        <div className={styles.scale} aria-hidden="true">
          <div className={styles.track}>
            <span className={styles.zM} style={{ width: pos(scale.warn) }} />
            <span className={styles.zW} style={{ width: `calc(${pos(scale.danger)} - ${pos(scale.warn)})` }} />
            <span className={styles.zR} />
          </div>
          <span className={styles.marker} style={{ left: pos(value) }} />
          <span className={styles.cut} style={{ left: pos(scale.warn) }}>{fmt(scale.warn)}{unit}</span>
          <span className={styles.cut} style={{ left: pos(scale.danger) }}>{fmt(scale.danger)}{unit}</span>
        </div>
      ) : null}
      {meta ? <div className={styles.meta}>{meta}</div> : null}
    </div>
  )
}
