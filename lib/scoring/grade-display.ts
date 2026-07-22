import { ENGINE_VERSION, type OverallGrade } from '@posture-ai/engine'
import { GRADE_BANDS, toGrade } from '@posture-ai/engine/thresholds'

export type GradeDisplayTone = 'maintain' | 'warning' | 'danger'
export type GradeColorToken = '--maintain' | '--warning' | '--danger'

export interface GradeDisplayBand {
  readonly grade: OverallGrade
  readonly min: number
  readonly max: number
  readonly range: string
  readonly description: string
  readonly tone: GradeDisplayTone
  readonly colorToken: GradeColorToken
  /** Hex fallback for renderers such as @react-pdf that cannot consume CSS variables. */
  readonly hexColor: string
}

const DESCRIPTIONS = {
  S: 'Minimal deviation',
  A: 'Low deviation',
  B: 'Mild deviation',
  C: 'Moderate deviation',
  D: 'High deviation',
  E: 'Very high deviation',
} as const satisfies Record<OverallGrade, string>

const TONES = {
  S: 'maintain',
  A: 'maintain',
  B: 'warning',
  C: 'warning',
  D: 'danger',
  E: 'danger',
} as const satisfies Record<OverallGrade, GradeDisplayTone>

const COLOR_TOKENS = {
  maintain: '--maintain',
  warning: '--warning',
  danger: '--danger',
} as const satisfies Record<GradeDisplayTone, GradeColorToken>

export const GRADE_TONE_HEX_COLORS = Object.freeze({
  maintain: '#5BD5AC',
  warning: '#FF8918',
  danger: '#DA4E24',
} as const satisfies Record<GradeDisplayTone, string>)

/**
 * User-facing grade metadata projected directly from the engine thresholds.
 * The engine remains the sole owner of grade boundaries.
 */
export const GRADE_DISPLAY_BANDS: readonly GradeDisplayBand[] = Object.freeze(
  GRADE_BANDS.map((band, index) => {
    const min = index === 0 ? 0 : GRADE_BANDS[index - 1].max + 1
    const tone = TONES[band.grade]

    return Object.freeze({
      grade: band.grade,
      min,
      max: band.max,
      range: `${min}\u2013${band.max}`,
      description: DESCRIPTIONS[band.grade],
      tone,
      colorToken: COLOR_TOKENS[tone],
      hexColor: GRADE_TONE_HEX_COLORS[tone],
    })
  }),
)

export function getGradeDisplayBand(grade: OverallGrade): GradeDisplayBand {
  const band = GRADE_DISPLAY_BANDS.find(candidate => candidate.grade === grade)
  if (!band) throw new Error(`No display metadata configured for grade ${grade}`)
  return band
}

export function getGradeDisplayForScore(score: number): GradeDisplayBand {
  return getGradeDisplayBand(toGrade(score))
}

/** Current ranges must never be applied to a grade persisted by another engine version. */
export function usesCurrentGradeScale(scoringEngineVersion: string | null): boolean {
  return scoringEngineVersion === ENGINE_VERSION
}
