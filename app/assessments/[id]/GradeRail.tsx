import Icon from '@/components/array/Icon'
import { Surface } from '@/components/array/Surface'
import { ring, tint, tone } from '@/components/array/severity'
import { GRADE_DISPLAY_BANDS } from '@/lib/scoring/grade-display'
import type { GradeRailModel } from './reviewModel'
import styles from './AssessmentReview.module.css'

/**
 * The screen's subject: the grade, the deviation score, and where both sit on the
 * 0–100 scale — with the previous scan drawn on the same rail so improvement is
 * visible in the object itself rather than asserted in a caption.
 *
 * The rail's segments are the engine's grade boundaries as percentages, which is
 * the same scale the dot is positioned on. There is no second mapping to fall out
 * of step, so a dot can never render outside the band its letter names.
 */
export default function GradeRail({
  rail,
  scaleApplies,
}: {
  rail: GradeRailModel
  /**
   * False when the scan was recorded by a different or unknown scoring version.
   * The rail is the current grade scale, so it must not be drawn for a score the
   * current scale does not describe.
   */
  scaleApplies: boolean
}) {
  // Looked up rather than asserted: rail.grade is a plain string off the stored
  // assessment, and getGradeDisplayBand throws on anything it does not know. A
  // grade letter this build has no band for is exactly the case where a range
  // must not be invented, so an unknown grade renders no range at all.
  const gradeRange = GRADE_DISPLAY_BANDS.find(band => band.grade === rail.grade)?.range ?? null

  return (
    <Surface tier="feature">
      <div className={styles.railHead}>
        <div className={styles.railReadout}>
          <span
            className={styles.railGrade}
            style={{
              background: tint(rail.band),
              boxShadow: `inset 0 0 0 1px ${ring(rail.band)}`,
              color: tone(rail.band),
            }}
            aria-hidden="true"
          >
            {rail.grade}
          </span>
          <div>
            <p className={`${styles.railScore} n`}>
              {Math.round(rail.score)}
              <span className={styles.railScoreUnit}> /100</span>
            </p>
            <p className="t-quiet">deviation score</p>
          </div>
        </div>
        {rail.delta ? (
          <span
            className={styles.railDelta}
            style={{
              background: tint(rail.delta.band),
              color: tone(rail.delta.band),
              boxShadow: `inset 0 0 0 1px ${ring(rail.delta.band)}`,
            }}
          >
            <Icon name={rail.delta.icon} size={13} />
            <span className="n">{rail.delta.text}</span>
          </span>
        ) : null}
      </div>

      {scaleApplies ? (
        <>
          {/* /DESIGN.md: "A measurement is always shown with its reference range
              — never alone." The redesign kept the coarse Maintain/Monitor/Review
              band but dropped the grade's own numeric range, leaving 14 /100 with
              nothing to read it against. It sits inside the scaleApplies branch
              deliberately: these bounds describe the CURRENT scale only, and
              printing them beside a score recorded by another scoring version is
              exactly the misattribution usesCurrentGradeScale() exists to stop. */}
          {gradeRange ? (
            <p className={styles.railRange}>
              grade <span className="n">{rail.grade}</span> range{' '}
              <span className="n">{gradeRange}</span>
            </p>
          ) : null}

          <p className="sr-only">{rail.description}</p>

          <div className={styles.rail} aria-hidden="true">
            {rail.stops.map((stop, index) => {
              const start = index === 0 ? 0 : rail.stops[index - 1].end
              return (
                <span
                  key={stop.band}
                  className={styles.railBand}
                  style={{
                    left: `${start}%`,
                    width: `${stop.end - start}%`,
                    background: tone(stop.band),
                  }}
                />
              )
            })}

            {/* Drawn before the current reading so the live dot is never occluded
                by the history behind it. */}
            {rail.priorPosition === null ? null : (
              <span
                className={styles.railPrior}
                style={{ left: `${rail.priorPosition}%` }}
              />
            )}

            <span
              className={styles.railDot}
              style={{ left: `${rail.position}%`, background: tone(rail.band) }}
            />
          </div>

          <div className={styles.railLabels} aria-hidden="true">
            {rail.stops.map(stop => (
              <span key={stop.band} style={{ color: tone(stop.band) }}>{stop.label}</span>
            ))}
          </div>

          <p className={styles.railNote}>
            {rail.priorLabel ? <><span className="n">{rail.priorLabel}</span>{' — '}</> : null}
            {rail.note}
          </p>
        </>
      ) : (
        <p className={styles.railNote}>
          Recorded with a different or unknown scoring version, so the current grade
          scale is not applied to it.
        </p>
      )}
    </Surface>
  )
}
