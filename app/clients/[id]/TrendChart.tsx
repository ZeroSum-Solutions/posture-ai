'use client'
import { startTransition, useEffect, useState } from 'react'
import Icon from '@/components/array/Icon'
import { Surface } from '@/components/array/Surface'
import { tint, tone, ring } from '@/components/array/severity'
import { buildTrendChart, CHART_VIEWBOX, type TrendInputPoint } from './trendModel'
import styles from './ClientDetail.module.css'

const DEFERRED_SCORE_TABLE_MOUNT_MS = 300

/**
 * The deviation-score trend, drawn by hand.
 *
 * This replaced a recharts LineChart. The chart has exactly one job — carry the
 * annotations that make the number readable: the score and grade at each point,
 * the maintain band labelled where it sits, and the measurement tolerance drawn
 * to scale on the latest reading. A general charting library gave none of those
 * for free and cost ~90KB of d3 to say so.
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
  const [isScoreTableOpen, setIsScoreTableOpen] = useState(false)
  const [isScoreTableMounted, setIsScoreTableMounted] = useState(false)

  useEffect(() => {
    if (!isScoreTableOpen || isScoreTableMounted) return
    // Expanding a populated table inside the glass feature card made the native
    // summary interaction synchronously lay out and repaint the rest of this
    // long page. Let the open disclosure paint first, then retain the table so
    // later closes and reopens do no additional mount work.
    const timer = window.setTimeout(() => {
      startTransition(() => setIsScoreTableMounted(true))
    }, DEFERRED_SCORE_TABLE_MOUNT_MS)
    return () => window.clearTimeout(timer)
  }, [isScoreTableMounted, isScoreTableOpen])

  if (model.points.length === 0) {
    return (
      <Surface tier="feature">
        <h2 className="t-title">Deviation score</h2>
        <p className="t-quiet" style={{ marginTop: 6 }}>
          No screening score has been recorded yet. The first completed scan starts this trend.
        </p>
      </Surface>
    )
  }

  const latestBand = model.points[model.points.length - 1].band

  return (
    <Surface tier="feature">
      <div className={styles.trendHead}>
        <div>
          <h2 className="t-title">Deviation score</h2>
          <p className="t-quiet" style={{ marginTop: 2 }}>Lower is better</p>
        </div>
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
          preserveAspectRatio="none"
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

          {/* The maintain band is a labelled region, not a coloured block behind
              body text — the label sits on the tint, the data sits over it. */}
          <rect
            x="0"
            y={model.maintainBand.y}
            width={CHART_VIEWBOX.width}
            height={model.maintainBand.height}
            fill={tint('maintain')}
          />
          <text
            x="6"
            y={model.maintainBand.y + model.maintainBand.height - 6}
            fill={tone('maintain')}
            fillOpacity="0.75"
            fontSize="9"
            letterSpacing="0.04em"
          >
            {model.maintainBand.label}
          </text>

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
              /* preserveAspectRatio="none" stretches the x axis; without this
                 the stroke would render thicker vertically than horizontally. */
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

          <g fontSize="10.5" fontWeight="400">
            {model.points.map((point, index) => point.showValueLabel ? (
              <text
                key={point.id}
                x={point.x}
                y={point.y - 13}
                fill={point.isLatest ? '#fff' : 'rgba(255,255,255,0.85)'}
                fontWeight={point.isLatest ? 500 : 400}
                textAnchor={index === 0 ? 'start' : point.isLatest ? 'end' : 'middle'}
              >
                {point.valueLabel}
              </text>
            ) : null)}
          </g>

          <g fontSize="10" fill="rgba(255,255,255,0.45)">
            {model.points.map((point, index) => point.showDateLabel ? (
              <text
                key={point.id}
                x={point.x}
                y={CHART_VIEWBOX.height - 8}
                textAnchor={index === 0 ? 'start' : point.isLatest ? 'end' : 'middle'}
              >
                {point.dateLabel}
              </text>
            ) : null)}
          </g>
        </svg>
      </div>

      <p className={styles.trendFootnote}>{model.footnote}</p>

      <details className={styles.dataDetails} open={isScoreTableOpen}>
        <summary
          className={styles.dataSummary}
          onClick={(event) => {
            event.preventDefault()
            setIsScoreTableOpen(open => !open)
          }}
        >
          Recorded scores
        </summary>
        {isScoreTableMounted ? (
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
                  <td>{new Date(point.assessedAt).toLocaleDateString('en-GB', {
                    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
                  })}</td>
                  <td>{point.grade ?? '—'}</td>
                  <td className="n">{point.score === null ? '—' : `${Math.round(point.score)} / 100`}</td>
                  <td>{point.scoringEngineVersion ?? 'Unknown — not comparable'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : isScoreTableOpen ? (
          <p className={styles.loadingPanel} role="status">Preparing recorded scores…</p>
        ) : null}
      </details>
    </Surface>
  )
}
