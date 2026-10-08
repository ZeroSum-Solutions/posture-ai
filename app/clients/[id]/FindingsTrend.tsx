import { REPEAT_CAPTURE_LIMITATION_COPY } from '@/lib/comparison/policy'
import { buildFindingsTrend, type FindingsTrendAssessment } from './findingsModel'
import { formatClientDate } from './clientDate'
import FindingHistory from './FindingHistory'
import styles from './ClientDetail.module.css'

/**
 * Every finding across every loaded scan: the full finding-history matrix
 * (band word + beads per cell, newest first), then the exact recorded
 * severities as a table behind a disclosure. The client page shows the same
 * matrix trimmed to the latest scan's worst findings and four scans.
 */
export default function FindingsTrend({
  assessments,
}: {
  assessments: readonly FindingsTrendAssessment[]
}) {
  const series = buildFindingsTrend(assessments)

  if (series.length === 0) {
    return (
      <div className={styles.panelEmpty} data-testid="findings-trend">
        <p className="t-body">No findings have been recorded for this client yet.</p>
        <p className="t-label">Findings appear here once a completed scan has been scored.</p>
      </div>
    )
  }

  return (
    <div className={styles.panelStack} data-testid="findings-trend">
      <FindingHistory assessments={assessments} maxScans={assessments.length} caption="Every finding across loaded scans" />

      <details className={styles.dataDetails}>
        <summary className={styles.dataSummary}>Recorded severity readings</summary>
        <p className={styles.trendFootnote}>
          Severity is a 0–100% scale; lower values indicate less recorded deviation. {REPEAT_CAPTURE_LIMITATION_COPY}
        </p>
        <div className={styles.tableScroll}>
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
                  <td>{formatClientDate(assessment.assessedAt, 'day-month-short')}</td>
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
        </div>
      </details>
    </div>
  )
}
