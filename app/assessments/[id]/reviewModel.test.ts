import { describe, expect, it } from 'vitest'
import { SCORE_BAND_STOPS } from '@/components/array/severity'
import { FIXED_COMPARISON_TOLERANCE } from '@/lib/comparison/policy'
import {
  buildReviewModel,
  FINDING_REFERENCE_TICK,
  GRADE_RAIL_STOPS,
  type ReviewFindingInput,
  type ReviewPriorInput,
} from './reviewModel'

const ENGINE = '2.1.0'

function finding(overrides: Partial<ReviewFindingInput> & { id: string }): ReviewFindingInput {
  return {
    imbalance_key: overrides.id,
    label: `Finding ${overrides.id}`,
    region: 'spine',
    severity_pct: 40,
    zone: 'warning',
    deviation: 12.4,
    direction: 'left',
    standard: 2,
    unit: '°',
    ...overrides,
  }
}

function model({
  score = 46,
  grade = 'C',
  findings = [finding({ id: 'a' })],
  prior = null,
  engine = ENGINE,
}: {
  score?: number
  grade?: string
  findings?: ReviewFindingInput[]
  prior?: ReviewPriorInput | null
  engine?: string | null
} = {}) {
  return buildReviewModel({
    assessment: {
      overall_score: score,
      overall_grade: grade,
      scoring_engine_version: engine,
      assessed_at: '2026-07-12T00:00:00Z',
    },
    findings,
    prior,
    scanLabel: 'Scan · 12 Jul 2026',
    priorLabel: '4 Jun',
  })
}

function prior(overrides: Partial<ReviewPriorInput> = {}): ReviewPriorInput {
  return {
    overall_score: 62,
    scoring_engine_version: ENGINE,
    assessed_at: '2026-06-04T00:00:00Z',
    findings: [{ imbalance_key: 'a', severity_pct: 55, zone: 'danger', unit: '°' }],
    ...overrides,
  }
}

describe('review verdict', () => {
  it('leads with the grade and names what drives it', () => {
    const result = model({
      findings: [
        finding({ id: 'a', zone: 'warning' }),
        finding({ id: 'b', zone: 'danger' }),
        finding({ id: 'c', zone: 'maintain' }),
      ],
    })
    expect(result.verdict.headline.lead).toBe('Grade C.')
    expect(result.verdict.headline.tail).toBe('Two findings drive the score.')
    expect(result.verdict.kicker).toBe('Scan · 12 Jul 2026')
  })

  it('says so when nothing is out of range', () => {
    const result = model({ grade: 'A', score: 6, findings: [finding({ id: 'a', zone: 'maintain' })] })
    expect(result.verdict.headline.tail).toBe('No findings are outside range.')
  })

  it('uses the singular for one flagged finding', () => {
    const result = model({ findings: [finding({ id: 'a', zone: 'danger' })] })
    expect(result.verdict.headline.tail).toBe('One finding drives the score.')
  })

  it('describes a lower deviation score without claiming clinical improvement', () => {
    expect(model({ prior: prior() }).verdict.headline.lead).toBe('Grade C, score decreased.')
    expect(model({ prior: null }).verdict.headline.lead).toBe('Grade C.')
    const drift = FIXED_COMPARISON_TOLERANCE.overallScorePoints - 1
    expect(model({ prior: prior({ overall_score: 46 + drift }) }).verdict.headline.lead).toBe('Grade C.')
  })

  it('describes a higher deviation score without claiming clinical worsening', () => {
    expect(model({ prior: prior({ overall_score: 20 }) }).verdict.headline.lead).toBe('Grade C, score increased.')
  })
})

describe('grade rail', () => {
  it('splits the rail at the engine grade boundaries', () => {
    expect(GRADE_RAIL_STOPS.map(stop => stop.end)).toEqual([
      SCORE_BAND_STOPS.maintain, SCORE_BAND_STOPS.monitor, 100,
    ])
    expect(GRADE_RAIL_STOPS.map(stop => stop.band)).toEqual(['maintain', 'monitor', 'review'])
  })

  it('puts the dot inside the band its grade names', () => {
    const maintain = model({ grade: 'B', score: 18 }).rail
    expect(maintain.band).toBe('maintain')
    expect(maintain.position).toBeLessThanOrEqual(SCORE_BAND_STOPS.maintain)

    const review = model({ grade: 'D', score: 70 }).rail
    expect(review.band).toBe('review')
    expect(review.position).toBeGreaterThan(SCORE_BAND_STOPS.monitor)
  })

  it('draws the prior reading and names it', () => {
    const rail = model({ prior: prior() }).rail
    expect(rail.priorPosition).toBe(62)
    expect(rail.priorLabel).toBe('4 Jun')
    expect(rail.note).toContain('faded dot is the previous scan')
  })

  it('omits the prior dot when the two scans are not comparable', () => {
    const rail = model({ prior: prior({ scoring_engine_version: '1.0.0' }) }).rail
    expect(rail.priorPosition).toBeNull()
    expect(rail.priorLabel).toBeNull()
    expect(rail.delta).toBeNull()
    expect(rail.note).toContain('not comparable')
  })

  it('invites a second scan when there is no prior at all', () => {
    const rail = model().rail
    expect(rail.priorPosition).toBeNull()
    expect(rail.note).toContain('A second scan adds the previous reading')
  })

  it('carries the delta against the last scan', () => {
    const rail = model({ prior: prior() }).rail
    expect(rail.delta?.text).toBe('−16 vs last scan')
    expect(rail.delta?.band).toBe('neutral')
    expect(rail.delta?.icon).toBe('arrow-down-linear')
    expect(rail.note).toContain('meaningful change are not established')
  })

  it('clamps a score outside the scale rather than drawing off the rail', () => {
    expect(model({ score: 140 }).rail.position).toBe(100)
    expect(model({ score: -5 }).rail.position).toBe(0)
  })

  it('describes the rail in words for assistive technology', () => {
    const rail = model({ prior: prior() }).rail
    expect(rail.description).toContain('46 out of 100')
    expect(rail.description).toContain('grade C')
    expect(rail.description).toContain('Previous scan 62')
    expect(rail.description).toContain('lower is better'.replace('l', 'L'))
  })
})

describe('review finding rows', () => {
  it('orders the worst finding first and an unusable reading last', () => {
    const result = model({
      findings: [
        finding({ id: 'mild', severity_pct: 10, zone: 'maintain' }),
        finding({ id: 'broken', severity_pct: 99, zone: 'unreliable' }),
        finding({ id: 'bad', severity_pct: 80, zone: 'danger' }),
      ],
    })
    expect(result.rows.map(row => row.id)).toEqual(['bad', 'mild', 'broken'])
    expect(result.rows[2].reliable).toBe(false)
  })

  it('bands a row from its zone, and labels Monitor for the warning zone', () => {
    const rows = model({ findings: [finding({ id: 'a', zone: 'warning' })] }).rows
    expect(rows[0].band).toBe('monitor')
    expect(rows[0].zoneLabel).toBe('Monitor')
  })

  it('formats the recorded measurement and its reference', () => {
    const rows = model({ findings: [finding({ id: 'a', deviation: 12.44, standard: 2, unit: '°' })] }).rows
    expect(rows[0].measurement).toBe('12.4°')
    expect(rows[0].reference).toBe('ref 2.0°')
  })

  it('omits the measurement and reference when no unit was recorded', () => {
    const rows = model({ findings: [finding({ id: 'a', unit: null, standard: null })] }).rows
    expect(rows[0].measurement).toBeNull()
    expect(rows[0].reference).toBeNull()
  })

  it('carries a per-finding delta from the shared policy', () => {
    const rows = model({ findings: [finding({ id: 'a', severity_pct: 40 })], prior: prior() }).rows
    expect(rows[0].delta).toBe('−15.0')
    expect(rows[0].deltaBand).toBe('neutral')
    expect(rows[0].deltaIcon).toBe('arrow-down-linear')
  })

  it('shows no delta at all when there is no prior scan', () => {
    const rows = model().rows
    expect(rows[0].delta).toBeNull()
    expect(rows[0].deltaWord).toBeNull()
  })

  it('says "not comparable" when a prior exists but the pair is not comparable', () => {
    const rows = model({
      findings: [finding({ id: 'a', unit: 'cm' })],
      prior: prior(),
    }).rows
    expect(rows[0].delta).toBeNull()
    expect(rows[0].deltaWord).toBe('not comparable')
  })

  it('shows the signed recorded difference inside the fixed fallback boundary', () => {
    const rows = model({
      findings: [finding({ id: 'a', severity_pct: 53 })],
      prior: prior(),
    }).rows
    expect(rows[0].delta).toBe('−2.0')
    expect(rows[0].deltaBand).toBe('neutral')
    expect(rows[0].deltaIcon).toBe('arrow-down-linear')
    expect(rows[0].deltaWord).toBeNull()
  })

  it('puts the reference tick at the published warn cut-point', () => {
    expect(FINDING_REFERENCE_TICK).toBe(33)
  })
})

describe('review counts', () => {
  it('counts flagged, maintaining and unusable readings separately', () => {
    const result = model({
      findings: [
        finding({ id: 'a', zone: 'warning' }),
        finding({ id: 'b', zone: 'danger' }),
        finding({ id: 'c', zone: 'maintain' }),
        finding({ id: 'd', zone: 'unreliable' }),
      ],
    })
    expect(result.counts).toEqual({ review: 2, maintain: 1, unreliable: 1 })
  })
})
