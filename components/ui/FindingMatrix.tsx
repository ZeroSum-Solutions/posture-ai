'use client'

import { Beads, type BeadBand } from './Beads'
import styles from './FindingMatrix.module.css'

export type MatrixCell = { band: BeadBand; value?: string } | null

/**
 * Findings over time (docs/design/array-v4-dataviz.md § H): one row per
 * finding, one column per recent scan (newest first). Each cell shows the band
 * initial + beads; "—" when there is no result. The finding column is sticky,
 * the scans scroll horizontally. Cells are buttons when `onCell` is given.
 */
export function FindingMatrix({
  findings,
  scans,
  cells,
  onCell,
  caption = 'Findings across recent scans',
}: {
  findings: { key: string; name: string }[]
  scans: { id: string; label: string }[]
  /** cells[findingKey][scanId] */
  cells: Record<string, Record<string, MatrixCell>>
  onCell?: (findingKey: string, scanId: string) => void
  caption?: string
}) {
  const word = { maintain: 'Maintain', monitor: 'Monitor', review: 'Review', neutral: 'Not scored' } as const
  return (
    <div className={styles.wrap}>
      <table className={styles.table}>
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            <th scope="col" className={styles.corner}><span className="t-micro">Finding</span></th>
            {scans.map((s, i) => (
              <th key={s.id} scope="col" className={styles.scanHead} data-latest={i === 0 ? 'true' : undefined}>
                <span className="t-micro">{s.label}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {findings.map((f, r) => (
            <tr key={f.key} style={{ '--r': r } as React.CSSProperties}>
              <th scope="row" className={styles.name}>{f.name}</th>
              {scans.map((s, i) => {
                const c = cells[f.key]?.[s.id] ?? null
                const body = c ? (
                  <>
                    <Beads band={c.band} size={5} />
                    <span className={styles.cellWord} data-band={c.band}>{word[c.band]}</span>
                  </>
                ) : <span className={styles.none} aria-label="No result">—</span>
                return (
                  <td key={s.id} className={styles.cell} data-latest={i === 0 ? 'true' : undefined}>
                    {onCell && c ? (
                      <button type="button" className={styles.cellBtn} onClick={() => onCell(f.key, s.id)} aria-label={`${f.name}, ${s.label}: ${word[c.band]}${c.value ? `, ${c.value}` : ''}`}>
                        {body}
                      </button>
                    ) : <span className={styles.cellStatic}>{body}</span>}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
