import Icon from '@/components/array/Icon'
import { Surface } from '@/components/array/Surface'
import { BAND_LABEL, tone } from '@/components/array/severity'
import { buildFindingsTrend, SPARK_VIEWBOX, type FindingsTrendAssessment } from './findingsModel'
import styles from './ClientDetail.module.css'

/**
 * One row per finding: label, latest severity, direction, and a sparkline.
 *
 * Each sparkline shares the same time axis as the others, so two rows can be
 * read against each other, and each carries the same comparison policy as the
 * Compare workspace so the two surfaces cannot disagree.
 */
export default function FindingsTrend({
  assessments,
}: {
  assessments: readonly FindingsTrendAssessment[]
}) {
  const series = buildFindingsTrend(assessments)

  if (series.length === 0) {
    return (
      <Surface tier="tile">
        <p className="t-body">No findings have been recorded for this client yet.</p>
        <p className="t-quiet" style={{ marginTop: 4 }}>
          Findings appear here once a completed scan has been scored.
        </p>
      </Surface>
    )
  }

  return (
    <div className="app-stack">
      <p className={styles.trendFootnote} style={{ paddingTop: 0, borderTop: 0 }}>
        Severity is a 0–100% ramp; lower is better. A line breaks wherever a reading is
        missing, unreliable, or scored by a different engine version.
      </p>

      {series.map(entry => (
        <Surface key={entry.key} tier="row" pad="rowy">
          <div className={styles.findingRow}>
            <div className={styles.findingBody}>
              <p className={styles.findingLabel}>{entry.label}</p>
              {/* When the movement is directional the delta beside this row says
                  so in one glyph and one number; repeating the policy's full
                  phrase here wrapped the line and squeezed the sparkline. The
                  phrase is shown when there is no delta — which is exactly when
                  it carries information the row would otherwise lack. */}
              <p className={styles.findingMeta}>
                {entry.latest
                  ? <>
                    <span className="n">{entry.latest.severity.toFixed(1)}%</span>
                    {' · '}
                    {entry.verdict?.magnitude
                      ? BAND_LABEL[entry.latest.band]
                      : entry.verdict?.text ?? BAND_LABEL[entry.latest.band]}
                  </>
                  : 'No reliable reading'}
              </p>
            </div>

            {entry.verdict?.magnitude ? (
              <span
                className={`${styles.findingDelta} n`}
                style={{ color: tone(entry.verdict.band) }}
              >
                <Icon name={entry.verdict.icon} size={12} />
                {entry.verdict.magnitude}
              </span>
            ) : null}

            {entry.points.length > 0 ? (
              <svg
                viewBox={`0 0 ${SPARK_VIEWBOX.width} ${SPARK_VIEWBOX.height}`}
                className={styles.spark}
                aria-hidden="true"
                focusable="false"
              >
                {entry.runs.map((run, index) => (
                  <polyline
                    key={index}
                    points={run}
                    fill="none"
                    stroke={tone(entry.latest?.band ?? 'neutral')}
                    strokeOpacity="0.75"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  />
                ))}
                {entry.points.map((point, index) => (
                  <circle
                    key={point.assessmentId}
                    cx={point.x}
                    cy={point.y}
                    r={index === entry.points.length - 1 ? 2.6 : 1.6}
                    fill={tone(entry.latest?.band ?? 'neutral')}
                  />
                ))}
              </svg>
            ) : null}
          </div>
          <p className="sr-only">{entry.description}</p>
        </Surface>
      ))}

      <details className={styles.dataDetails}>
        <summary className={styles.dataSummary}>Recorded severity readings</summary>
        <table className={styles.dataTable}>
          <caption className="sr-only">
            Recorded severity percentage per finding, per scan, newest first.
          </caption>
          <thead>
            <tr>
              <th scope="col">Date</th>
              <th scope="col">Scoring version</th>
              {series.map(entry => <th key={entry.key} scope="col">{entry.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {[...assessments].reverse().map(assessment => (
              <tr key={assessment.id}>
                <td>{new Date(assessment.assessedAt).toLocaleDateString('en-GB', {
                  day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
                })}</td>
                <td>{assessment.scoringEngineVersion ?? 'Unknown — not comparable'}</td>
                {series.map(entry => {
                  const reading = assessment.findings.find(candidate => candidate.key === entry.key)
                  const severity = reading === undefined || reading.severityPct === null
                    ? null
                    : Number(reading.severityPct)
                  const usable = severity !== null
                    && Number.isFinite(severity)
                    && reading?.zone !== null
                    && reading?.zone !== 'unreliable'
                  return (
                    <td key={entry.key} className="n">
                      {usable ? `${severity.toFixed(1)}%` : '—'}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  )
}
