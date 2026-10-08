'use client'
import { useState } from 'react'
import { Button, ScoreScale, Sheet, SlotNumber } from '@/components/ui'
import { REPEAT_CAPTURE_LIMITATION_COPY } from '@/lib/comparison/policy'
import { GRADE_DISPLAY_BANDS } from '@/lib/scoring/grade-display'
import type { GradeRailModel } from './reviewModel'
import styles from './Results.module.css'

/**
 * The screen's answer (Array v4 › Results hero): the deviation score as a hero
 * numeral with a slot reveal, read against a full-width 0–100 scale with the
 * band cutoffs printed (docs/design/array-v4-dataviz.md § C). One line under
 * it names the grade and its numeric range; the recorded difference from the
 * previous comparable scan is plain text. How to read it lives behind "Why?".
 *
 * The scale's cutoffs are the engine's grade boundaries, so the marker always
 * sits in the band the grade names. When the scan was scored by another
 * version the scale is not drawn at all: it describes the current scale only.
 */
export default function GradeRail({
  rail,
  scaleApplies,
  kicker,
}: {
  rail: GradeRailModel
  /**
   * False when the scan was recorded by a different or unknown scoring version.
   * The scale is the current grade scale, so it must not be drawn for a score the
   * current scale does not describe.
   */
  scaleApplies: boolean
  /** Eyebrow above the numeral, e.g. `Screening · 7 Sep`. */
  kicker?: string
}) {
  const [whyOpen, setWhyOpen] = useState(false)
  // Looked up rather than asserted: rail.grade is a plain string off the stored
  // assessment. A grade this build has no band for renders no range at all.
  const gradeRange = GRADE_DISPLAY_BANDS.find(band => band.grade === rail.grade)?.range ?? null
  const label = kicker ? `${kicker} · Deviation score` : 'Deviation score'

  if (!scaleApplies) {
    return (
      <div className={styles.scoreHero}>
        <p className="t-micro">{label}</p>
        {/* Only stored facts: no band name and no range, since those are the
            interpretations the current scale would have to supply. */}
        <p className="sr-only">
          {`Grade ${rail.grade}, deviation score ${Math.round(rail.score)} out of 100, as recorded.`}
        </p>
        <div className={styles.scoreRecorded} aria-hidden="true">
          <SlotNumber value={Math.round(rail.score)} className={styles.scoreNumeral} />
          <span className={styles.scoreOf}>/100</span>
        </div>
        <p className={styles.scoreLine}>
          Grade <span className="n">{rail.grade}</span> · Recorded with a different or unknown scoring version, so
          the current grade scale is not applied to it.
        </p>
      </div>
    )
  }

  return (
    <div className={styles.scoreHero}>
      <p className="sr-only">{rail.description}</p>
      <div aria-hidden="true">
        <ScoreScale score={rail.score} label={label} />
      </div>
      <div className={styles.scoreLine}>
        <span>
          Grade <span className="n">{rail.grade}</span>
          {gradeRange ? <> · range <span className="n">{gradeRange}</span></> : null}
        </span>
        {rail.delta ? (
          <span className={`${styles.scoreDelta} n`}>
            {rail.delta.icon === 'arrow-down-linear' ? '↓ ' : rail.delta.icon === 'arrow-up-linear' ? '↑ ' : ''}
            {rail.delta.text}
          </span>
        ) : null}
        <Button variant="tertiary" size="sm" className={styles.whyButton} onClick={() => setWhyOpen(true)}>
          Why?
        </Button>
      </div>

      <Sheet open={whyOpen} onOpenChange={setWhyOpen} title="Reading the score" detents={['medium', 'large']}>
        <div className={styles.whyBody}>
          <p className="t-body">
            Lower is better. The marker shows this scan on the 0–100 deviation scale; the cutoffs are the grade
            boundaries.
          </p>
          <p className="t-body">
            {rail.priorLabel ? <><span className="n">{rail.priorLabel}</span>{' — '}</> : null}
            {rail.note.replace(/^The faded dot is the previous scan\. /, 'The previous comparable scan is noted in text. ')}
          </p>
          {!rail.note.includes(REPEAT_CAPTURE_LIMITATION_COPY) ? (
            <p className="t-label">{REPEAT_CAPTURE_LIMITATION_COPY}</p>
          ) : null}
          <table className={styles.gradeTable}>
            <caption className="t-micro">Grade reference</caption>
            <thead>
              <tr><th scope="col">Grade</th><th scope="col">Score</th><th scope="col">Meaning</th></tr>
            </thead>
            <tbody>
              {GRADE_DISPLAY_BANDS.map(band => (
                <tr key={band.grade} aria-current={band.grade === rail.grade ? 'true' : undefined}>
                  <td>{band.grade}</td>
                  <td className="n">{band.range}</td>
                  <td>{band.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Sheet>
    </div>
  )
}
