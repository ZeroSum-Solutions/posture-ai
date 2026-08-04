import Icon from '@/components/array/Icon'
import { Surface } from '@/components/array/Surface'
import { BAND_TONE, FINDING_BAND_STOPS, tone } from '@/components/array/severity'
import MuscleBodyMap from './MuscleBodyMap'
import { hasAnyMuscle } from './muscleMap'
import { FINDING_REFERENCE_TICK, type ReviewFindingRow } from './reviewModel'
import styles from './AssessmentReview.module.css'

/**
 * One row per finding: name, zone, recorded measurement, its movement since the
 * last scan, and a banded range bar carrying the reference tick.
 *
 * The bar's band stops and the tick come from the engine's severity ramp, so the
 * value dot lands in the band the row's zone label names. An unusable reading
 * draws no bar at all — a bar implies a position on a scale, and an unreliable
 * measurement has none.
 */
function RangeBar({ row }: { row: ReviewFindingRow }) {
  return (
    <div className={styles.bar} aria-hidden="true">
      <span
        className={styles.barBand}
        style={{ left: 0, width: `${FINDING_BAND_STOPS.warn}%`, background: BAND_TONE.maintain }}
      />
      <span
        className={styles.barBand}
        style={{
          left: `${FINDING_BAND_STOPS.warn}%`,
          width: `${FINDING_BAND_STOPS.danger - FINDING_BAND_STOPS.warn}%`,
          background: BAND_TONE.monitor,
        }}
      />
      <span
        className={styles.barBand}
        style={{
          left: `${FINDING_BAND_STOPS.danger}%`,
          width: `${100 - FINDING_BAND_STOPS.danger}%`,
          background: BAND_TONE.review,
        }}
      />
      {/* The published in-range cut-point. It is a fixed reference, not derived
          from this finding's value, so it never moves between rows. */}
      <span className={styles.barTick} style={{ left: `${FINDING_REFERENCE_TICK}%` }} />
      <span
        className={styles.barDot}
        style={{ left: `${row.severity}%`, background: tone(row.band) }}
      />
    </div>
  )
}

export default function ReviewFindings({
  rows,
  onOverride,
}: {
  rows: readonly ReviewFindingRow[]
  /** Opens the practitioner's override for this finding, when overrides exist. */
  onOverride?: (key: string) => void
}) {
  if (rows.length === 0) {
    return (
      <Surface tier="tile">
        <p className="t-body">No findings were recorded for this screening.</p>
      </Surface>
    )
  }

  return (
    <div className="app-stack">
      {rows.map(row => (
        <Surface key={row.id} tier="tile">
          <div className={styles.findingHead}>
            <div className={styles.findingName}>
              <p className={styles.findingLabel}>{row.label}</p>
              <p className={styles.findingZone} style={{ color: tone(row.band) }}>
                {row.zoneLabel}
                {row.borderline ? ' · borderline' : ''}
              </p>
            </div>
            <div className={styles.findingValue}>
              {row.measurement ? <span className="n">{row.measurement}</span> : null}
              {row.delta ? (
                <span className={`${styles.findingDelta} n`} style={{ color: tone(row.deltaBand) }}>
                  {row.deltaIcon ? <Icon name={row.deltaIcon} size={12} /> : null}
                  {row.delta}
                </span>
              ) : row.deltaWord ? (
                <span className={styles.findingDelta} style={{ color: tone('neutral') }}>
                  {row.deltaWord}
                </span>
              ) : null}
            </div>
          </div>

          {row.reliable ? <RangeBar row={row} /> : null}

          <div className={styles.findingFoot}>
            <span className="n">
              {row.reliable
                ? row.reference ?? 'no recorded reference'
                : 'Reading not usable — re-capture this view'}
            </span>
            {onOverride ? (
              <button
                type="button"
                className={styles.overrideButton}
                onClick={() => onOverride(row.key)}
              >
                {row.zoneLabel}
                <Icon name="pen-linear" size={13} />
              </button>
            ) : (
              <span style={{ color: tone(row.band) }}>{row.zoneLabel}</span>
            )}
          </div>

          <p className="sr-only">
            {row.label}: {row.zoneLabel}.
            {row.measurement ? ` Recorded ${row.measurement}.` : ''}
            {row.reference ? ` In-range reference ${row.reference}.` : ''}
            {row.reliable ? '' : ' This reading is not usable and needs re-capturing.'}
          </p>

          {/* Native details/summary, so the expanded state is exposed without a
              hand-rolled aria-expanded to keep in step with the panel. */}
          {row.causes || hasAnyMuscle({
            tightMuscles: row.tightMuscles,
            weakMuscles: row.weakMuscles,
            tightLinks: row.tightLinks,
            weakLinks: row.weakLinks,
          }) ? (
            <details className={styles.disclosure} style={{ marginTop: 12 }}>
              <summary className={styles.disclosureSummary}>Muscle Analysis</summary>
              <div className={styles.disclosureBody}>
                {row.causes ? <p style={{ marginBottom: 12 }}>{row.causes}</p> : null}
                <MuscleBodyMap
                  tightMuscles={row.tightMuscles}
                  weakMuscles={row.weakMuscles}
                  tightLinks={row.tightLinks}
                  weakLinks={row.weakLinks}
                />
              </div>
            </details>
          ) : null}
        </Surface>
      ))}
    </div>
  )
}
