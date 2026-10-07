'use client'
import { startTransition, useEffect, useRef, useState } from 'react'
import Icon from '@/components/array/Icon'
import { Surface } from '@/components/array/Surface'
import { tint, tone, ring } from '@/components/array/severity'
import { buildTrendChart, CHART_VIEWBOX, type TrendInputPoint } from './trendModel'
import { formatClientDate } from './clientDate'
import styles from './ClientDetail.module.css'

const DEFERRED_SCORE_TABLE_MOUNT_MS = 300

function RecordedScoreDisclosure({
  history,
  tableId,
  footnote,
}: {
  history: readonly TrendInputPoint[]
  tableId: string
  footnote: string
}) {
  const [isOpen, setIsOpen] = useState(false)
  const [isTableMounted, setIsTableMounted] = useState(false)
  const [isPointerGuardReady, setIsPointerGuardReady] = useState(false)
  const disclosureRef = useRef<HTMLButtonElement>(null)
  const disclosureLabel = isPointerGuardReady ? 'Score details' : 'Preparing score details…'

  useEffect(() => {
    const disclosure = disclosureRef.current
    if (!disclosure) return
    // Chromium can spend most of this interaction repainting the glass-backed
    // chart while assigning mouse focus. Attach at the target so the native
    // focus path is cancelled before React's delegated event phase. Touch and
    // keyboard focus keep their normal semantics.
    const skipMouseFocus = (event: PointerEvent) => {
      if (event.pointerType === 'mouse' && event.button === 0 && event.isPrimary) {
        event.preventDefault()
      }
    }
    disclosure.addEventListener('pointerdown', skipMouseFocus)
    // The server-rendered control stays inert until hydration has installed the
    // native pointer guard. Otherwise its first pointerdown pays React's
    // selective-hydration cost as part of the interaction itself.
    setIsPointerGuardReady(true)
    return () => disclosure.removeEventListener('pointerdown', skipMouseFocus)
  }, [])

  useEffect(() => {
    if (!isOpen || isTableMounted) return
    // Let the disclosure paint first, then retain the table so later closes and
    // reopens do no additional mount work.
    const timer = window.setTimeout(() => {
      startTransition(() => setIsTableMounted(true))
    }, DEFERRED_SCORE_TABLE_MOUNT_MS)
    return () => window.clearTimeout(timer)
  }, [isOpen, isTableMounted])

  return (
    <div className={styles.dataDetails} data-open={isOpen}>
      <button
        ref={disclosureRef}
        type="button"
        className={styles.dataSummary}
        aria-label={disclosureLabel}
        aria-expanded={isOpen}
        aria-busy={!isPointerGuardReady}
        aria-controls={`${tableId}-panel`}
        disabled={!isPointerGuardReady}
        onClick={() => setIsOpen(open => !open)}
      >
        {disclosureLabel}
      </button>
      <div id={`${tableId}-panel`} hidden={!isOpen}>
        {isTableMounted ? (
          <>
            <p className={styles.trendFootnote}>{footnote}</p>
            <table className={styles.dataTable} id={tableId}>
              <caption className="sr-only">
                Every recorded screening score for this client, with its grade and scoring version.
              </caption>
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  <th scope="col">Grade</th>
                  <th scope="col">Score</th>
                  <th scope="col">Scoring version</th>
                </tr>
              </thead>
              <tbody>
                {[...history].reverse().map(point => (
                  <tr key={point.id}>
                    <td>{formatClientDate(point.assessedAt, 'day-month-short')}</td>
                    <td>{point.grade ?? '—'}</td>
                    <td className="n">{point.score === null ? '—' : `${Math.round(point.score)} / 100`}</td>
                    <td>{point.scoringEngineVersion ?? 'Unknown — not comparable'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ) : isOpen ? (
          <p className={styles.loadingPanel} role="status">Preparing score details…</p>
        ) : null}
      </div>
    </div>
  )
}

/**
 * The deviation-score trend, drawn by hand.
 *
 * This replaced a recharts LineChart. The chart has exactly one job — carry the
 * compact shape of the recorded scores and their maintain band while withholding
 * an uncertainty band until repeat-capture evidence exists. The current number
 * is written beside the chart, and exact dates, grades, values, versions, and the
 * method limitation remain in the accessible description and Score details.
 *
 * The drawing is `aria-hidden`; the sentence in `model.description` and the
 * table underneath are the accessible representation.
 */
export default function TrendChart({
  history,
  tableId,
}: {
  history: readonly TrendInputPoint[]
  tableId: string
}) {
  const model = buildTrendChart(history)
  const verdict = model.verdict

  if (model.points.length === 0) {
    return (
      <Surface tier="feature">
        <h2 className="t-headline">Deviation score</h2>
        <p className="t-footnote" style={{ marginTop: 6 }}>
          No screening score has been recorded yet. The first completed scan starts this trend.
        </p>
      </Surface>
    )
  }

  const latestBand = model.points[model.points.length - 1].band
  const latestPoint = model.points[model.points.length - 1]

  return (
    <Surface tier="feature" pad="snug">
      <div className={styles.trendHead}>
        <div>
          <h2 className="t-headline">Deviation score</h2>
          <p className="t-footnote" style={{ marginTop: 2 }}>Lower is better</p>
        </div>
        <div className={styles.trendHeadAside}>
          <span className={styles.latestScore} aria-label={`Latest deviation score ${Math.round(latestPoint.score)} out of 100`}>
            <span className="n">{Math.round(latestPoint.score)}</span>
            <span>/100</span>
          </span>
          {verdict?.magnitude ? (
            <span
              className={styles.verdictPill}
              style={{
                background: tint(verdict.band),
                color: tone(verdict.band),
                boxShadow: `inset 0 0 0 1px ${ring(verdict.band)}`,
              }}
            >
              <Icon name={verdict.icon} size={13} />
              <span className="n">{verdict.magnitude}</span>
            </span>
          ) : null}
        </div>
      </div>

      {/* The policy's wording is a phrase, not a word, so it gets a full-width
          line of its own. Squeezed into the pill beside the title it wrapped
          mid-number and pushed the heading out of the card. */}
      {verdict ? (
        <p className={styles.verdictLine} style={{ color: tone(verdict.band) }}>
          {verdict.text}
        </p>
      ) : null}

      <p className="sr-only">{model.description}</p>

      <div className={styles.chartBox}>
        <svg
          viewBox={`0 0 ${CHART_VIEWBOX.width} ${CHART_VIEWBOX.height}`}
          preserveAspectRatio="xMidYMid meet"
          className={styles.chart}
          aria-hidden="true"
          focusable="false"
        >
          <defs>
            <linearGradient id="trend-fill" x1="0" x2="0" y1="0" y2="1">
              <stop stopColor={tone(latestBand)} stopOpacity="0.26" />
              <stop offset="1" stopColor={tone(latestBand)} stopOpacity="0" />
            </linearGradient>
          </defs>

          <g stroke="rgba(255,255,255,0.09)" strokeWidth="1">
            {model.gridLines.map(line => (
              <line key={line.score} x1="0" y1={line.y} x2={CHART_VIEWBOX.width} y2={line.y} />
            ))}
          </g>

          {/* The maintain band stays visible as a reference region. Its exact
              boundary remains in the accessible description; putting text in
              this 60px sparkline makes the chart less legible on a phone. */}
          <rect
            x="0"
            y={model.maintainBand.y}
            width={CHART_VIEWBOX.width}
            height={model.maintainBand.height}
            fill={tint('maintain')}
          />
          {/* Drawn before the line and the dots so the data sits on top of its
              own uncertainty rather than behind it. */}
          {model.tolerance ? (
            <rect
              x={model.tolerance.x1}
              y={model.tolerance.y1}
              width={Math.max(0, model.tolerance.x2 - model.tolerance.x1)}
              height={Math.max(0, model.tolerance.y2 - model.tolerance.y1)}
              fill="rgba(255,255,255,0.16)"
            />
          ) : null}

          {model.areaPath ? <path d={model.areaPath} fill="url(#trend-fill)" /> : null}

          {model.runs.map(run => (
            <polyline
              key={run.segmentId}
              points={run.polyline}
              fill="none"
              stroke={tone(latestBand)}
              strokeWidth="2"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          ))}

          {model.points.map(point => (
            <circle
              key={point.id}
              cx={point.x}
              cy={point.y}
              r={point.isLatest ? 5 : 4.5}
              fill={point.isLatest ? tone(point.band) : '#000'}
              stroke={point.isLatest ? '#000' : tone(point.band)}
              strokeWidth="2"
              vectorEffect="non-scaling-stroke"
            />
          ))}

        </svg>
      </div>

      <RecordedScoreDisclosure history={history} tableId={tableId} footnote={model.footnote} />
    </Surface>
  )
}
