'use client'
// Progress-tab trend charts, split into their own chunk so recharts (+ d3) is
// fetched only when a multi-assessment client opens Progress. The parent keeps
// this component behind next/dynamic with ssr:false.
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import styles from './ClientEvidenceCanvas.module.css'

const SERIES_STYLES = [
  { stroke: 'var(--data-blue)', dash: undefined, dotRadius: 4 },
  { stroke: 'var(--brand-warm)', dash: '8 4', dotRadius: 3 },
  { stroke: 'var(--maintain)', dash: '3 3', dotRadius: 4 },
  { stroke: 'var(--text-secondary)', dash: '10 3 2 3', dotRadius: 3 },
] as const

export interface ProgressChartsProps {
  trendData: Record<string, number | string>[]
  imbalanceKeys: string[]
  imbalanceLabels: Record<string, string>
}

function numericValue(value: number | string | undefined) {
  if (value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function formatPercent(value: number | string) {
  const parsed = numericValue(value)
  return parsed === null ? '—' : `${parsed.toFixed(1)}%`
}

export default function ProgressCharts({ trendData, imbalanceKeys, imbalanceLabels }: ProgressChartsProps) {
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
          <h2 id="grade-trend-heading">Overall grade trend</h2>
          <p>Grade on a 0–100 display scale: S 100, A 83, B 66, C 50, D 33, E 0.</p>
        </header>
        <div
          className={styles.chartViewport}
          role="img"
          aria-label="Overall grade trend chart. The numeric data table follows."
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
              <ReferenceArea
                y1={66}
                y2={100}
                fill="color-mix(in srgb, var(--maintain) 8%, transparent)"
                label={{ value: 'Maintain 66–100', fill: 'var(--maintain)', fontSize: 10, position: 'insideTopRight' }}
              />
              <ReferenceArea
                y1={33}
                y2={66}
                fill="color-mix(in srgb, var(--warning) 8%, transparent)"
                label={{ value: 'Review 33–65', fill: 'var(--warning)', fontSize: 10, position: 'insideTopRight' }}
              />
              <ReferenceArea
                y1={0}
                y2={33}
                fill="color-mix(in srgb, var(--danger) 8%, transparent)"
                label={{ value: 'Significant 0–32', fill: 'var(--danger)', fontSize: 10, position: 'insideTopRight' }}
              />
              <Line
                type="monotone"
                dataKey="grade_pct"
                name="Grade display score"
                stroke="var(--data-blue)"
                strokeWidth={2}
                dot={{ fill: 'var(--data-blue)', r: 4, stroke: 'var(--surface)', strokeWidth: 1 }}
                activeDot={{ r: 6 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <details className={styles.tableDetails}>
          <summary className={styles.tableSummary}>View overall grade numeric data</summary>
          <table className={styles.dataTable}>
            <thead>
              <tr>
                <th scope="col">Assessment date</th>
                <th scope="col">Grade display score</th>
              </tr>
            </thead>
            <tbody>
              {trendData.map((point, index) => (
                <tr key={`${String(point.date)}-${index}`}>
                  <td>{String(point.date)}</td>
                  <td>{numericValue(point.grade_pct)?.toFixed(0) ?? '—'} / 100</td>
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
            <p>Severity percentage by finding. Lower is better; line labels, dash patterns, points, and numeric data reinforce the color coding.</p>
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
                <ReferenceArea y1={0} y2={33} fill="color-mix(in srgb, var(--maintain) 6%, transparent)" />
                <ReferenceArea y1={33} y2={66} fill="color-mix(in srgb, var(--warning) 6%, transparent)" />
                <ReferenceArea y1={66} y2={100} fill="color-mix(in srgb, var(--danger) 6%, transparent)" />
                {imbalanceKeys.map((key, index) => {
                  const seriesStyle = SERIES_STYLES[index % SERIES_STYLES.length]
                  return (
                    <Line
                      key={key}
                      type="monotone"
                      dataKey={key}
                      name={key}
                      stroke={seriesStyle.stroke}
                      strokeDasharray={seriesStyle.dash}
                      strokeWidth={2}
                      dot={{ r: seriesStyle.dotRadius, strokeWidth: 1 }}
                      activeDot={{ r: seriesStyle.dotRadius + 2 }}
                      connectNulls
                    />
                  )
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
