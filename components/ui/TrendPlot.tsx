'use client'

import { useMemo, useRef, useState } from 'react'
import { haptic } from '@/lib/haptics'
import { SCORE_CUTOFFS, scoreBand } from './ScoreScale'
import styles from './TrendPlot.module.css'

export type TrendPoint = {
  id: string
  /** ISO date of the scan. */
  date: string
  score: number | null
  /** False when this scan is not comparable with the previous one (break the line). */
  comparable?: boolean
  /** A quality flag (e.g. camera level not verified) — drawn as a diamond with "!". */
  flag?: string
}

const W = 340
const H = 180
const PAD = { l: 26, r: 64, t: 12, b: 26 }
const WORD = { maintain: 'Maintain', monitor: 'Monitor', review: 'Review' } as const

/** Date-only ISO strings are read as local noon so the day never shifts across time zones. */
function asDate(iso: string) {
  return new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T12:00:00` : iso)
}
function fmtDate(iso: string) {
  return asDate(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

/**
 * Change across scans (docs/design/array-v4-dataviz.md § D): real dates on x,
 * fixed 0–100 on y, labelled band fields, comparable scans joined, a gap
 * across non-comparable ones, flagged scans as a diamond. Tap/scrub snaps to
 * the nearest scan; Previous/Next buttons and the readout line make it usable
 * without precise pointing. The line draws itself once.
 */
export function TrendPlot({
  points,
  initialIndex,
  onSelect,
  label = 'Deviation score over time',
}: {
  points: TrendPoint[]
  initialIndex?: number
  onSelect?: (point: TrendPoint, index: number) => void
  label?: string
}) {
  const sorted = useMemo(() => [...points].sort((a, b) => +asDate(a.date) - +asDate(b.date)), [points])
  const [sel, setSel] = useState(initialIndex ?? sorted.length - 1)
  const svgRef = useRef<SVGSVGElement>(null)

  const t0 = sorted.length ? +asDate(sorted[0].date) : 0
  const t1 = sorted.length ? +asDate(sorted[sorted.length - 1].date) : 1
  const span = Math.max(1, t1 - t0)
  const x = (iso: string) => PAD.l + (sorted.length === 1 ? (W - PAD.l - PAD.r) / 2 : ((+asDate(iso) - t0) / span) * (W - PAD.l - PAD.r))
  const y = (v: number) => PAD.t + (1 - v / 100) * (H - PAD.t - PAD.b)

  const segments: string[] = []
  let cur = ''
  sorted.forEach((p, i) => {
    if (p.score == null) { if (cur) segments.push(cur); cur = ''; return }
    const pt = `${x(p.date).toFixed(1)},${y(p.score).toFixed(1)}`
    if (!cur || p.comparable === false || i === 0) { if (cur) segments.push(cur); cur = `M${pt}` } else cur += ` L${pt}`
  })
  if (cur) segments.push(cur)

  const choose = (i: number) => {
    const clamped = Math.max(0, Math.min(sorted.length - 1, i))
    if (clamped !== sel) haptic('tap')
    setSel(clamped)
    onSelect?.(sorted[clamped], clamped)
  }
  const nearest = (clientX: number) => {
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect) return sel
    const vx = ((clientX - rect.left) / rect.width) * W
    let best = 0
    sorted.forEach((p, i) => { if (Math.abs(x(p.date) - vx) < Math.abs(x(sorted[best].date) - vx)) best = i })
    return best
  }

  const s = sorted[sel]
  const sBand = s?.score != null ? scoreBand(s.score) : null
  const { maintainMax, monitorMax } = SCORE_CUTOFFS

  if (sorted.length === 0) return null
  return (
    <figure className={styles.root}>
      <figcaption className={styles.readout} aria-live="polite">
        <span className="t-micro">{fmtDate(s.date)}</span>
        <span className={styles.readValue}>{s.score == null ? 'No reliable reading' : Math.round(s.score)}</span>
        {sBand ? <span className={styles.readBand} data-band={sBand}>{WORD[sBand]}</span> : null}
        {s.flag ? <span className={styles.readFlag}>! {s.flag}</span> : null}
      </figcaption>
      <svg
        ref={svgRef}
        className={styles.svg}
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`${label}: ${sorted.map((p) => `${fmtDate(p.date)} ${p.score == null ? 'no reading' : Math.round(p.score)}`).join(', ')}`}
        onPointerDown={(e) => { (e.target as Element).setPointerCapture?.(e.pointerId); choose(nearest(e.clientX)) }}
        onPointerMove={(e) => { if (e.buttons) choose(nearest(e.clientX)) }}
      >
        <rect className={styles.fieldM} x={PAD.l} y={y(maintainMax)} width={W - PAD.l - PAD.r} height={y(0) - y(maintainMax)} rx="6" />
        <rect className={styles.fieldW} x={PAD.l} y={y(monitorMax)} width={W - PAD.l - PAD.r} height={y(maintainMax) - y(monitorMax)} rx="6" />
        <rect className={styles.fieldR} x={PAD.l} y={y(100)} width={W - PAD.l - PAD.r} height={y(monitorMax) - y(100)} rx="6" />
        {[0, 50, 100].map((v) => (
          <text key={v} className={styles.tick} x={PAD.l - 8} y={y(v) + 3} textAnchor="end">{v}</text>
        ))}
        <text className={styles.bandLabel} x={W - PAD.r + 10} y={(y(0) + y(maintainMax)) / 2 + 3}>Maintain</text>
        <text className={styles.bandLabel} x={W - PAD.r + 10} y={(y(maintainMax) + y(monitorMax)) / 2 + 3}>Monitor</text>
        <text className={styles.bandLabel} x={W - PAD.r + 10} y={(y(monitorMax) + y(100)) / 2 + 3}>Review</text>
        {s && s.score != null ? <line className={styles.cursor} x1={x(s.date)} x2={x(s.date)} y1={PAD.t} y2={H - PAD.b} /> : null}
        {segments.map((d, i) => <path key={i} className={styles.line} d={d} pathLength={1} />)}
        {sorted.map((p, i) => {
          if (p.score == null) return null
          const cx = x(p.date), cy = y(p.score)
          const on = i === sel
          return p.flag ? (
            <g key={p.id} className={styles.flag} data-on={on ? 'true' : undefined} style={{ animationDelay: `${300 + i * 60}ms` }}>
              <rect x={cx - 6} y={cy - 6} width="12" height="12" rx="2" transform={`rotate(45 ${cx} ${cy})`} />
              <text x={cx} y={cy + 3.5} textAnchor="middle">!</text>
            </g>
          ) : (
            <circle key={p.id} className={styles.dot} data-on={on ? 'true' : undefined} cx={cx} cy={cy} r={on ? 7 : 4.5} style={{ animationDelay: `${300 + i * 60}ms` }} />
          )
        })}
        {sorted.map((p, i) => (i === 0 || i === sorted.length - 1) ? (
          <text key={`d${p.id}`} className={styles.tick} x={x(p.date)} y={H - 6} textAnchor={i === 0 ? 'start' : 'end'}>{fmtDate(p.date)}</text>
        ) : null)}
      </svg>
      {sorted.length > 1 ? (
        <div className={styles.nav}>
          <button type="button" className={styles.navBtn} onClick={() => choose(sel - 1)} disabled={sel === 0} aria-label="Previous scan">‹</button>
          <span className={styles.navPos}>{sel + 1} of {sorted.length}</span>
          <button type="button" className={styles.navBtn} onClick={() => choose(sel + 1)} disabled={sel === sorted.length - 1} aria-label="Next scan">›</button>
        </div>
      ) : null}
    </figure>
  )
}
