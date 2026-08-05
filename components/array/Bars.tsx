import {
  BAND_TONE,
  FINDING_BAND_STOPS,
  SCORE_BAND_STOPS,
  tone,
  type SeverityBand,
} from './severity'
import styles from './Bars.module.css'

const clamp = (value: number) => Math.max(0, Math.min(100, value))

function tintedTrack(stops: { first: number; second: number }, alpha: number) {
  const a = (hex: string) => `color-mix(in srgb, ${hex} ${Math.round(alpha * 100)}%, transparent)`
  return `linear-gradient(to right, ${a(BAND_TONE.maintain)} 0 ${stops.first}%, ${a(BAND_TONE.monitor)} ${stops.first}% ${stops.second}%, ${a(BAND_TONE.review)} ${stops.second}% 100%)`
}

/**
 * One finding on its banded range, with the reference cut-point as a white tick
 * and the measured value as a dot coloured by its band.
 *
 * `severityPct` comes straight from the engine, where 0–33 is inside the warn
 * threshold, 33–66 sits between warn and danger, and 66–100 is beyond danger —
 * so the tick at 33% is the published reference boundary, not a guess.
 */
export function RangeBar({
  severityPct,
  band,
  label,
}: {
  severityPct: number
  band: SeverityBand
  /** Read out to assistive tech, since the bar itself is decorative. */
  label: string
}) {
  return (
    <div className={styles.range} role="img" aria-label={label}>
      <div
        className={styles.rangeTrack}
        style={{ background: tintedTrack({ first: FINDING_BAND_STOPS.warn, second: FINDING_BAND_STOPS.danger }, 0.28) }}
      />
      <div className={styles.rangeRef} style={{ left: `${FINDING_BAND_STOPS.warn}%` }} />
      <div className={styles.rangeDot} style={{ left: `${clamp(severityPct)}%`, background: tone(band) }} />
    </div>
  )
}

/**
 * The deviation score on its grade rail: bright dot is this scan, faded dot the
 * previous one, so improvement is visible in the object itself rather than
 * asserted in copy. Band edges are the engine's own grade boundaries, so the
 * dot always lands inside the band its letter names.
 */
export function ScoreRail({
  score,
  previousScore,
  label,
}: {
  score: number
  previousScore?: number | null
  label: string
}) {
  const stops = { first: SCORE_BAND_STOPS.maintain, second: SCORE_BAND_STOPS.monitor }
  return (
    <>
      <div className={styles.rail} role="img" aria-label={label}>
        <div className={styles.railTrack} style={{ background: tintedTrack(stops, 0.55) }} />
        <div className={styles.railEdge} style={{ left: `${stops.first}%` }} />
        <div className={styles.railEdge} style={{ left: `${stops.second}%` }} />
        {previousScore == null ? null : (
          <div className={styles.railPrev} style={{ left: `${clamp(previousScore)}%` }} />
        )}
        <div className={styles.railNow} style={{ left: `${clamp(score)}%` }} />
      </div>
      <div className={styles.railLegend}>
        <span style={{ color: BAND_TONE.maintain }}>Maintain</span>
        <span style={{ color: BAND_TONE.monitor }}>Monitor</span>
        <span style={{ color: BAND_TONE.review }}>Review</span>
      </div>
    </>
  )
}
