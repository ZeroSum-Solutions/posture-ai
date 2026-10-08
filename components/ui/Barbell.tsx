import styles from './Barbell.module.css'

export type BarbellRow = { key: string; name: string; left: number | null; right: number | null; unit: string }

/**
 * Left/right pairs (docs/design/array-v4-dataviz.md § I): one row per paired
 * measure on a shared scale from 0. Left is a dot, right a square, joined by a
 * line, so the gap between them reads as the asymmetry. Values are printed.
 */
export function Barbell({ rows, max, caption = 'Left and right comparison' }: { rows: BarbellRow[]; max?: number; caption?: string }) {
  const top = max ?? Math.max(1, ...rows.flatMap((r) => [r.left ?? 0, r.right ?? 0])) * 1.15
  const pct = (v: number) => `${Math.min(100, (v / top) * 100)}%`
  const fmt = (v: number | null, unit: string) => (v == null ? '—' : `${v.toFixed(1)}${unit}`)
  return (
    <figure className={styles.root}>
      <figcaption className={styles.legend}>
        <span className="t-micro">{caption}</span>
        <span className={styles.key}><i className={styles.lDot} /> Left <i className={styles.rSq} /> Right</span>
      </figcaption>
      {rows.map((r, i) => {
        const lo = Math.min(r.left ?? 0, r.right ?? 0)
        const hi = Math.max(r.left ?? 0, r.right ?? 0)
        return (
          <div key={r.key} className={styles.row} style={{ '--i': i } as React.CSSProperties}>
            <div className={styles.labels}>
              <span className={styles.name}>{r.name}</span>
              <span className={styles.vals}>L {fmt(r.left, r.unit)} · R {fmt(r.right, r.unit)}</span>
            </div>
            <div className={styles.track} role="img" aria-label={`${r.name}: left ${fmt(r.left, r.unit)}, right ${fmt(r.right, r.unit)}`}>
              {r.left != null && r.right != null ? (
                <span className={styles.bar} style={{ left: pct(lo), width: `calc(${pct(hi)} - ${pct(lo)})` }} />
              ) : null}
              {r.left != null ? <span className={styles.lMark} style={{ left: pct(r.left) }} /> : null}
              {r.right != null ? <span className={styles.rMark} style={{ left: pct(r.right) }} /> : null}
            </div>
          </div>
        )
      })}
    </figure>
  )
}
