'use client'
// Progress-tab trend charts, split into their own chunk so recharts (+ d3) is
// fetched only after bounded history confirms a client has multiple assessments.
// The parent keeps this component behind next/dynamic with ssr:false.
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { trendValueForSegment } from '@/lib/comparison/trends'
import styles from './ClientEvidenceCanvas.module.css'

const SERIES_STYLES = [
  { stroke: 'var(--data-blue)', dash: undefined, dotRadius: 4 },
  { stroke: 'var(--brand-warm)', dash: '8 4', dotRadius: 3 },
  { stroke: 'var(--maintain)', dash: '3 3', dotRadius: 4 },
  { stroke: 'var(--text-secondary)', dash: '10 3 2 3', dotRadius: 3 },
] as const

export interface ProgressChartsProps {
  trendData: Record<string, number | string | null>[]
  trendSegments: Array<{ id: string; scoringEngineVersion: string | null }>
  imbalanceKeys: string[]
  imbalanceLabels: Record<string, string>
}

function numericValue(value: number | string | null | undefined) {
  if (value === undefined || value === null || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function formatPercent(value: number | string | null) {
  const parsed = numericValue(value)
  return parsed === null ? '—' : `${parsed.toFixed(1)}%`
}

function versionLabel(value: unknown) {
  return typeof value === 'string' && value.trim() ? value : 'Unknown — not comparable'
}

export default function ProgressCharts({ trendData, trendSegments, imbalanceKeys, imbalanceLabels }: ProgressChartsProps) {
  if (trendData.length === 0) {
    return (
      <div className={styles.emptyState} role="status">
        No progress data is available yet. Complete another assessment to start a trend.
      </div>
    )
  }

  return (
    <div className={styles.progressStack}>
      <section className={styles.chartCard} aria-labelledby="grade-trend-heading">
        <header className={styles.chartHeader}>
          <h2 id="grade-trend-heading">Recorded screening score over time</h2>
          <p>Deviation score from 0–100; lower is better. Lines stop at every scoring-version boundary. The chart shows recorded values only and does not label movement as improvement or regression; use Compare for the measurement-tolerance decision.</p>
        </header>
        <div className={styles.versionKey} aria-label="Scoring version segments">
          <strong>Scoring version segments</strong>
          <ul>
            {trendSegments.map((segment, index) => (
              <li key={segment.id}>
                <span className={styles.versionSwatch} data-series-index={index % SERIES_STYLES.length} aria-hidden="true" />
                <span>{versionLabel(segment.scoringEngineVersion)}</span>
              </li>
            ))}
          </ul>
        </div>
        <div
          className={styles.chartViewport}
          role="img"
          aria-label="Recorded screening score trend chart. The numeric data table follows."
        >
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={trendData} margin={{ top: 12, right: 18, bottom: 8, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" />
              <XAxis dataKey="date" tick={{ fill: 'var(--text-secondary)', fontSize: 11 }} />
              <YAxis domain={[0, 100]} tick={{ fill: 'var(--text-secondary)', fontSize: 11 }} />
              <Tooltip
                contentStyle={{
                  background: 'var(--surface-elevated)',
                  border: '1px solid var(--glass-border)',
                  borderRadius: '10px',
                }}
                labelStyle={{ color: 'var(--text-primary)' }}
                itemStyle={{ color: 'var(--text-secondary)' }}
              />
              {trendSegments.map((segment, index) => {
                const seriesStyle = SERIES_STYLES[index % SERIES_STYLES.length]
                return (
                  <Line
                    key={segment.id}
                    type="monotone"
                    dataKey={(point: Record<string, unknown>) => trendValueForSegment(point, segment.id, 'overall_score')}
                    name={`Deviation score — ${versionLabel(segment.scoringEngineVersion)}`}
                    stroke={seriesStyle.stroke}
                    strokeDasharray={seriesStyle.dash}
                    strokeWidth={2}
                    dot={{ fill: seriesStyle.stroke, r: 4, stroke: 'var(--surface)', strokeWidth: 1 }}
                    activeDot={{ r: 6 }}
                    connectNulls={false}
                  />
                )
              })}
            </LineChart>
          </ResponsiveContainer>
        </div>
        <details className={styles.tableDetails}>
          <summary className={styles.tableSummary}>View recorded score data</summary>
          <table className={styles.dataTable}>
            <thead>
              <tr>
                <th scope="col">Assessment date</th>
                <th scope="col">Scoring version</th>
                <th scope="col">Recorded grade</th>
                <th scope="col">Deviation score</th>
              </tr>
            </thead>
            <tbody>
              {trendData.map((point, index) => (
                <tr key={`${String(point.date)}-${index}`}>
                  <td>{String(point.date)}</td>
                  <td>{versionLabel(point.scoring_engine_version)}</td>
                  <td>{typeof point.overall_grade === 'string' ? point.overall_grade : '—'}</td>
                  <td>{numericValue(point.overall_score)?.toFixed(0) ?? '—'} / 100</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      </section>

      {imbalanceKeys.length > 0 ? (
        <section className={styles.chartCard} aria-labelledby="severity-trend-heading">
          <header className={styles.chartHeader}>
            <h2 id="severity-trend-heading">Finding severity over time</h2>
            <p>Severity percentage by finding. Lower is better. Lines stop at scoring-version boundaries and missing or unreliable readings. Recorded lines are descriptive only; improvement and regression labels come from Compare after applying measurement tolerance.</p>
          </header>
          <div
            className={`${styles.chartViewport} ${styles.chartViewportTall}`}
            role="img"
            aria-label="Finding severity trend chart. The labelled numeric data list follows."
          >
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trendData} margin={{ top: 12, right: 18, bottom: 8, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" />
                <XAxis dataKey="date" tick={{ fill: 'var(--text-secondary)', fontSize: 11 }} />
                <YAxis domain={[0, 100]} tick={{ fill: 'var(--text-secondary)', fontSize: 11 }} unit="%" />
                <Tooltip
                  contentStyle={{
                    background: 'var(--surface-elevated)',
                    border: '1px solid var(--glass-border)',
                    borderRadius: '10px',
                  }}
                  labelStyle={{ color: 'var(--text-primary)' }}
                  itemStyle={{ color: 'var(--text-secondary)' }}
                  formatter={(value: number | string, name: string) => [
                    formatPercent(value),
                    imbalanceLabels[name] || name,
                  ]}
                />
                <Legend
                  formatter={(value) => imbalanceLabels[value] || value}
                  wrapperStyle={{ fontSize: '11px', color: 'var(--text-secondary)' }}
                />
                {imbalanceKeys.flatMap((key, index) => {
                  const seriesStyle = SERIES_STYLES[index % SERIES_STYLES.length]
                  return trendSegments.map((segment, segmentIndex) => (
                    <Line
                      key={`${key}-${segment.id}`}
                      type="monotone"
                      dataKey={(point: Record<string, unknown>) => trendValueForSegment(point, segment.id, key)}
                      name={key}
                      stroke={seriesStyle.stroke}
                      strokeDasharray={seriesStyle.dash}
                      strokeWidth={2}
                      dot={{ r: seriesStyle.dotRadius, strokeWidth: 1 }}
                      activeDot={{ r: seriesStyle.dotRadius + 2 }}
                      connectNulls={false}
                      legendType={segmentIndex === 0 ? 'line' : 'none'}
                    />
                  ))
                })}
              </LineChart>
            </ResponsiveContainer>
          </div>
          <details className={styles.tableDetails}>
            <summary className={styles.tableSummary}>View finding severity numeric data</summary>
            <ul className={styles.chartDataList} aria-label="Finding severity numeric data">
              {trendData.map((point, pointIndex) => (
                <li className={styles.chartDataRow} key={`${String(point.date)}-${pointIndex}`}>
                  <strong>{String(point.date)}</strong>
                  <span>Scoring version: {versionLabel(point.scoring_engine_version)}</span>
                  <dl className={styles.chartDataValues}>
                    {imbalanceKeys.map((key) => (
                      <div key={key}>
                        <dt>{imbalanceLabels[key] || key}</dt>
                        <dd>{point[key] === undefined ? '—' : formatPercent(point[key])}</dd>
                      </div>
                    ))}
                  </dl>
                </li>
              ))}
            </ul>
          </details>
        </section>
      ) : (
        <div className={styles.emptyState} role="status">
          No comparable finding severity values are available for this client’s assessments.
        </div>
      )}
    </div>
  )
}
