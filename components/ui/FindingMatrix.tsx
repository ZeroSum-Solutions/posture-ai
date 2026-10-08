'use client'

import { useEffect, useRef, useState } from 'react'
import { Beads, type BeadBand } from './Beads'
import styles from './FindingMatrix.module.css'

export type MatrixCell = { band: BeadBand; value?: string } | null

/**
 * Findings over time (docs/design/array-v4-dataviz.md § H): one row per
 * finding, one column per recent scan (newest first). Each cell shows the band
 * initial + beads; "—" when there is no result. Three scan columns fit the
 * screen (down to 360px); older scans scroll horizontally under the sticky
 * finding column, with an "Older" cue and edge fade while more lie offscreen.
 * Cells are beads + word on the canvas — a surface appears only on press or
 * keyboard focus. Cells are buttons when `onCell` is given.
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
  const wrapRef = useRef<HTMLDivElement>(null)
  const [more, setMore] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const update = () => {
      setMore(el.scrollLeft + el.clientWidth < el.scrollWidth - 4)
      setScrolled(el.scrollLeft > 4)
    }
    update()
    el.addEventListener('scroll', update, { passive: true })
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update)
    ro?.observe(el)
    return () => { el.removeEventListener('scroll', update); ro?.disconnect() }
  }, [scans.length])
  return (
    <div className={styles.root}>
    <div className={styles.wrap} ref={wrapRef} data-more={more ? 'true' : undefined} data-scrolled={scrolled ? 'true' : undefined}>
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
    {more || scrolled ? (
      <div className={styles.pager}>
        <button
          type="button"
          className={styles.pagerBtn}
          onClick={() => {
            const el = wrapRef.current
            if (!el) return
            const head = el.querySelector('th[scope="col"]:nth-child(2)') as HTMLElement | null
            const step = head?.offsetWidth ?? 80
            const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
            el.scrollTo({ left: more ? el.scrollLeft + step : 0, behavior: still ? 'auto' : 'smooth' })
          }}
        >
          {more ? 'Older scans ›' : '‹ Latest scans'}
        </button>
      </div>
    ) : null}
    </div>
  )
}
