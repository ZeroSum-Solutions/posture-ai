'use client'
import {
  MEASUREMENT_TOLERANCE_COPY,
  comparisonDecisionText,
  comparisonStatusText,
  comparisonTone,
  type ComparisonDecision,
} from '@/lib/comparison/policy'
import styles from './ClientEvidenceCanvas.module.css'

export type ComparisonAssessment = {
  id: string
  assessedAt: string
  overallGrade: string | null
  overallScore: number | null
  scoringEngineVersion: string | null
  status: string
}

export type ComparisonDeltaRow = {
  key: string
  label: string
  baseDeviation: number | null
  targetDeviation: number | null
  baseUnit: string
  targetUnit: string
  unit: string
  delta: number | null
  comparison: ComparisonDecision
}

export type ComparisonWorkspaceProps = {
  assessments: readonly ComparisonAssessment[]
  baseId: string
  targetId: string
  deltaRows: readonly ComparisonDeltaRow[]
  overallComparison: ComparisonDecision | null
  onBaseChange: (assessmentId: string) => void
  onTargetChange: (assessmentId: string) => void
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function formatStatus(status: string) {
  return status
    .split('_')
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(' ')
}

function formatMeasurement(value: number | null, unit: string, showSign = false) {
  if (value === null) return '—'
  const sign = showSign && value > 0 ? '+' : ''
  return `${sign}${value.toFixed(1)}${unit}`
}

export default function ComparisonWorkspace({
  assessments,
  baseId,
  targetId,
  deltaRows,
  overallComparison,
  onBaseChange,
  onTargetChange,
}: ComparisonWorkspaceProps) {
  const chronologicalAssessments = [...assessments].sort((left, right) => {
    const dateDifference = Date.parse(left.assessedAt) - Date.parse(right.assessedAt)
    return dateDifference || left.id.localeCompare(right.id)
  })
  const baseAssessment = chronologicalAssessments.find((assessment) => assessment.id === baseId)
  const baseTime = baseAssessment ? Date.parse(baseAssessment.assessedAt) : null
  const laterAssessments = baseTime === null
    ? []
    : chronologicalAssessments.filter((assessment) => Date.parse(assessment.assessedAt) > baseTime)
  const targetAssessment = chronologicalAssessments.find((assessment) => assessment.id === targetId)
  const overallStatus = overallComparison?.status ?? 'not_comparable'
  const overallTone = comparisonTone(overallStatus)
  const overallLabel = comparisonStatusText(overallStatus, 'overall')
  const directionClass = overallTone === 'positive'
    ? styles.directionImproved
    : overallTone === 'negative'
      ? styles.directionRegressed
      : styles.directionNeutral

  return (
    <section className={styles.comparisonWorkspace} aria-labelledby="comparison-heading">
      <div className={styles.selectorPanel}>
        <header className={styles.workspaceHeader}>
          <h2 id="comparison-heading">Compare two assessments</h2>
          <p>Select an earlier baseline and a strictly later comparison. Screening measurements remain tied to their assessment dates.</p>
        </header>
        <div className={styles.selectorGrid}>
          <div className={styles.selectorField}>
            <label className={styles.selectorLabel} htmlFor="compare-before">Before (baseline)</label>
            <select
              className={styles.select}
              id="compare-before"
              value={baseId}
              onChange={(event) => onBaseChange(event.target.value)}
            >
              {chronologicalAssessments.map((assessment) => (
                <option key={assessment.id} value={assessment.id}>
                  {formatDate(assessment.assessedAt)} — Grade {assessment.overallGrade ?? 'not graded'}
                </option>
              ))}
            </select>
          </div>
          <div className={styles.selectorBridge} aria-hidden="true">earlier → later</div>
          <div className={styles.selectorField}>
            <label className={styles.selectorLabel} htmlFor="compare-after">After (comparison)</label>
            <select
              className={styles.select}
              id="compare-after"
              value={targetId}
              onChange={(event) => onTargetChange(event.target.value)}
              disabled={laterAssessments.length === 0}
            >
              {laterAssessments.length === 0 && <option value="">No later assessment available</option>}
              {laterAssessments.map((assessment) => (
                <option key={assessment.id} value={assessment.id}>
                  {formatDate(assessment.assessedAt)} — Grade {assessment.overallGrade ?? 'not graded'}
                </option>
              ))}
            </select>
          </div>
        </div>
        {laterAssessments.length === 0 && (
          <p className={styles.selectorStatus} role="status">
            No later assessment is available. Choose an earlier Before assessment.
          </p>
        )}
      </div>
      {baseAssessment && targetAssessment ? (
        <div className={styles.comparisonSequence} role="region" aria-label="Selected assessment sequence">
          <article className={styles.assessmentCard}>
            <h3 className={styles.cardHeading}>Before assessment</h3>
            <p className={styles.assessmentDate}>{formatDate(baseAssessment.assessedAt)}</p>
            <p className={styles.gradeReadout}>Grade {baseAssessment.overallGrade ?? '—'}</p>
            <p className={styles.statusLabel}>{formatStatus(baseAssessment.status)}</p>
          </article>
          <article className={styles.transitionCard}>
            <h3 className={styles.cardHeading}>Change summary</h3>
            <p className={`${styles.directionBadge} ${directionClass}`}>{overallLabel}</p>
            <p className={styles.transitionNote}>
              {overallComparison?.status === 'not_comparable'
                ? comparisonDecisionText(overallComparison, 'overall')
                : MEASUREMENT_TOLERANCE_COPY}
            </p>
          </article>
          <article className={styles.assessmentCard}>
            <h3 className={styles.cardHeading}>After assessment</h3>
            <p className={styles.assessmentDate}>{formatDate(targetAssessment.assessedAt)}</p>
            <p className={styles.gradeReadout}>Grade {targetAssessment.overallGrade ?? '—'}</p>
            <p className={styles.statusLabel}>{formatStatus(targetAssessment.status)}</p>
          </article>
        </div>
      ) : (
        <p className={styles.emptyState} role="status">Choose a chronological Before and After assessment to compare.</p>
      )}
      {deltaRows.length > 0 && (
        <section className={styles.evidencePanel} aria-labelledby="comparison-evidence-heading">
          <h3 className={styles.evidenceHeading} id="comparison-evidence-heading">Finding comparison</h3>
          <p className={styles.evidenceIntro}>Measurements are shown as recorded. Status comes from severity percentage points, where lower is better. Raw measurement deltas never set the status.</p>
          <ul className={styles.evidenceList} aria-label="Finding comparison evidence">
            {deltaRows.map((row) => (
              <li className={styles.evidenceRow} id={`finding-${row.key}`} key={row.key}>
                <h4>{row.label}</h4>
                <dl className={styles.evidenceData}>
                  <div>
                    <dt>Before</dt>
                    <dd>{formatMeasurement(row.baseDeviation, row.baseUnit)}</dd>
                  </div>
                  <div>
                    <dt>After</dt>
                    <dd>{formatMeasurement(row.targetDeviation, row.targetUnit)}</dd>
                  </div>
                  <div>
                    <dt>Delta</dt>
                    <dd>{formatMeasurement(row.delta, row.unit, true)}</dd>
                  </div>
                  <div>
                    <dt>Status</dt>
                    <dd className={`${styles.rowStatus} ${
                      comparisonTone(row.comparison.status) === 'positive'
                        ? styles.rowImproved
                        : comparisonTone(row.comparison.status) === 'negative'
                          ? styles.rowRegressed
                          : styles.rowNeutral
                    }`}>
                      {comparisonDecisionText(row.comparison, 'finding')}
                    </dd>
                  </div>
                </dl>
              </li>
            ))}
          </ul>
        </section>
      )}
      {baseAssessment && targetAssessment && deltaRows.length === 0 && (
        <p className={styles.emptyState} role="status">
          No comparable findings are available for this assessment pair. Open each assessment to review its evidence.
        </p>
      )}
    </section>
  )
}
