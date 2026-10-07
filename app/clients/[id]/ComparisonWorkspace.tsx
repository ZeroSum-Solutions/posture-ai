'use client'
import { Chip, GradeChip } from '@/components/array/Chip'
import Icon from '@/components/array/Icon'
import { Surface } from '@/components/array/Surface'
import { tone } from '@/components/array/severity'
import {
  MEASUREMENT_TOLERANCE_COPY,
  comparisonDeltaText,
  comparisonDecisionText,
  comparisonStatusText,
  comparisonTone,
  type ComparisonDecision,
} from '@/lib/comparison/policy'
import styles from './ClientDetail.module.css'
import { comparePostgresTimestamps } from '@/lib/time/postgres-timestamp'
import { formatClientDate } from './clientDate'

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
  return formatClientDate(iso, 'month-day-short')
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

/** Recorded differences remain visually neutral until meaningful change is established. */
function bandFor(status: ComparisonDecision['status']) {
  const direction = comparisonTone(status)
  if (direction === 'positive') return 'maintain' as const
  if (direction === 'negative') return 'review' as const
  return 'neutral' as const
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
    const dateDifference = comparePostgresTimestamps(left.assessedAt, right.assessedAt) ?? 0
    return dateDifference || left.id.localeCompare(right.id)
  })
  const baseAssessment = chronologicalAssessments.find((assessment) => assessment.id === baseId)
  const laterAssessments = !baseAssessment
    ? []
    : chronologicalAssessments.filter(
        (assessment) => comparePostgresTimestamps(assessment.assessedAt, baseAssessment.assessedAt) === 1,
      )
  const targetAssessment = chronologicalAssessments.find((assessment) => assessment.id === targetId)
  const overallStatus = overallComparison?.status ?? 'not_comparable'
  const overallLabel = overallComparison
    ? [comparisonDecisionText(overallComparison, 'overall'), comparisonDeltaText(overallComparison)]
        .filter(Boolean).join(' · ')
    : comparisonStatusText(overallStatus, 'overall')

  return (
    <section className="app-stack" aria-labelledby="comparison-heading">
      <Surface tier="tile">
        <h2 className="t-headline" id="comparison-heading">Compare two assessments</h2>
        <p className="t-footnote" style={{ marginTop: 4, marginBottom: 14, lineHeight: 1.6 }}>
          Select an earlier baseline and a strictly later comparison. Screening measurements
          remain tied to their assessment dates.
        </p>
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
          <div className={styles.selectorBridge} aria-hidden="true">
            <Icon name="arrow-right-linear" size={16} />
          </div>
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
      </Surface>

      {baseAssessment && targetAssessment ? (
        /* Before, change, After stay three headed sections in this order. The
           order is the reading order for assistive technology, so it is a
           semantic guarantee rather than a layout choice. */
        <div className={styles.sequenceGrid} role="region" aria-label="Selected assessment sequence">
          {/* Reading order is Before, Change summary, After. The grid places the
              two readouts side by side and the summary beneath them without
              reordering the DOM, so the spoken sequence stays chronological. */}
          <Surface tier="tile" className={styles.sequenceBefore}>
            <h3 className={styles.cardHeading}>Before assessment</h3>
            <div className={styles.gradeReadout}>
              <GradeChip grade={baseAssessment.overallGrade} />
              <div style={{ minWidth: 0 }}>
                <p className={styles.assessmentDate} style={{ marginTop: 0 }}>
                  {formatDate(baseAssessment.assessedAt)}
                </p>
                <p className={styles.assessmentDate}>{formatStatus(baseAssessment.status)}</p>
              </div>
            </div>
          </Surface>

          <Surface tier="tile" className={styles.sequenceChange}>
            <div className={styles.trendHead}>
              <h3 className="t-headline">Change summary</h3>
              <Chip band={bandFor(overallStatus)} size="sm">{overallLabel}</Chip>
            </div>
            <p className={styles.transitionNote}>
              {overallComparison?.status === 'not_comparable'
                ? comparisonDecisionText(overallComparison, 'overall')
                : MEASUREMENT_TOLERANCE_COPY}
            </p>
          </Surface>

          <Surface tier="tile" className={styles.sequenceAfter}>
            <h3 className={styles.cardHeading}>After assessment</h3>
            <div className={styles.gradeReadout}>
              <GradeChip grade={targetAssessment.overallGrade} />
              <div style={{ minWidth: 0 }}>
                <p className={styles.assessmentDate} style={{ marginTop: 0 }}>
                  {formatDate(targetAssessment.assessedAt)}
                </p>
                <p className={styles.assessmentDate}>{formatStatus(targetAssessment.status)}</p>
              </div>
            </div>
          </Surface>
        </div>
      ) : (
        <Surface tier="tile">
          <p className={styles.emptyState} role="status">
            Choose a chronological Before and After assessment to compare.
          </p>
        </Surface>
      )}

      {deltaRows.length > 0 && (
        <section aria-labelledby="comparison-evidence-heading" className="app-stack">
          <div className={styles.sectionHead}>
            <h3 className="t-title-2" id="comparison-evidence-heading">Finding comparison</h3>
          </div>
          <p className="t-body" style={{ padding: '0 8px' }}>
            Measurements are shown as recorded. Status comes from severity percentage points,
            where lower values indicate less recorded deviation. Raw measurement deltas never set the status.
          </p>
          <ul
            aria-label="Finding comparison evidence"
            style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 10 }}
          >
            {deltaRows.map((row) => (
              <li id={`finding-${row.key}`} key={row.key}>
                <Surface tier="row" pad="rowy">
                  <div className={styles.evidenceRow}>
                    <div className={styles.evidenceBody}>
                      <h4 className={styles.evidenceLabel}>{row.label}</h4>
                      {/* The three readings stay individually labelled. Sighted
                          readers get the labels from position; a screen reader
                          gets them from the terms. */}
                      <dl className={`${styles.evidenceData} n`}>
                        <div>
                          <dt className="sr-only">Before</dt>
                          <dd>{formatMeasurement(row.baseDeviation, row.baseUnit)}</dd>
                        </div>
                        <div aria-hidden="true" className={styles.evidenceArrow}>→</div>
                        <div>
                          <dt className="sr-only">After</dt>
                          <dd>{formatMeasurement(row.targetDeviation, row.targetUnit)}</dd>
                        </div>
                        <div>
                          <dt className="sr-only">Change</dt>
                          <dd>{formatMeasurement(row.delta, row.unit, true)}</dd>
                        </div>
                      </dl>
                    </div>
                    <p
                      className={styles.rowStatus}
                      style={{ color: tone(bandFor(row.comparison.status)) }}
                    >
                      {comparisonDecisionText(row.comparison, 'finding')}
                      {comparisonDeltaText(row.comparison) ? ` · ${comparisonDeltaText(row.comparison)}` : ''}
                    </p>
                  </div>
                </Surface>
              </li>
            ))}
          </ul>
        </section>
      )}

      {baseAssessment && targetAssessment && deltaRows.length === 0 && (
        <Surface tier="tile">
          <p className={styles.emptyState} role="status">
            No comparable findings are available for this assessment pair. Open each assessment
            to review its evidence.
          </p>
        </Surface>
      )}
    </section>
  )
}
