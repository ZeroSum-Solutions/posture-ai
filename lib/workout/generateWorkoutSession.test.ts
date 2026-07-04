import { describe, it, expect, test } from 'vitest'
import type { Finding } from '../../packages/posture-engine/src/types'
import { buildProgramFrom } from '../program/buildProgram'
import { generateWorkoutSession, type SessionSnapshot } from './generateWorkoutSession'
import { ALL_EXERCISES } from '../../content'

// Synthetic reliable findings that produce two real priorities through the
// actual selectPriorities → buildProgramFrom pipeline (no mocked report).
function finding(partial: Partial<Finding> & Pick<Finding, 'key' | 'region' | 'zone' | 'severityPct'>): Finding {
  return {
    label: partial.key,
    deviation: 10,
    standard: 0,
    unit: 'deg',
    direction: 'Forward',
    viewUsed: 'side',
    confidence: 0.9,
    reliable: partial.zone !== 'unreliable',
    landmarksUsed: [],
    ...partial,
  }
}

const FINDINGS: Finding[] = [
  finding({ key: 'forward_head_posture', region: 'head_shoulders', zone: 'danger', severityPct: 80 }),
  finding({ key: 'anterior_pelvic_shift', region: 'pelvis', zone: 'warning', severityPct: 50 }),
]

const report = () => buildProgramFrom(FINDINGS, 'C')

const BAND: Record<string, number> = { mobility: 0, stretch: 1, activation: 2, strengthen: 3 }

describe('generateWorkoutSession', () => {
  it('flattens the report into one playable session with items', () => {
    const snap = generateWorkoutSession(report(), { week: 1 })!
    expect(snap).not.toBeNull()
    expect(snap.week).toBe(1)
    expect(snap.items.length).toBeGreaterThan(0)
    // priorities carried for intro/traceability
    expect(snap.priorities.map((p) => p.primaryKey)).toContain('forward_head_posture')
  })

  it('orders items by step band across priorities (warm up globally once), Connect last', () => {
    const snap = generateWorkoutSession(report(), { week: 3 })!
    const core = snap.items.filter((i) => !i.isIntegrative)
    const bands = core.map((i) => BAND[i.category])
    expect([...bands].sort((a, b) => a - b)).toEqual(bands) // non-decreasing
    // any integrative Connect item is pinned to the very end
    const firstIntegrative = snap.items.findIndex((i) => i.isIntegrative)
    if (firstIntegrative !== -1) {
      expect(snap.items.slice(firstIntegrative).every((i) => i.isIntegrative)).toBe(true)
    }
  })

  it('derives timing from the dosage of the requested week', () => {
    const snap = generateWorkoutSession(report(), { week: 1 })!
    for (const item of snap.items) {
      if (item.timing.kind === 'hold') {
        expect(item.timing.secondsPerSet).toBeGreaterThan(0)
      } else {
        expect(item.timing.repsPerSet).toBeGreaterThan(0)
      }
      expect(item.timing.sets).toBeGreaterThan(0)
      expect(item.timing.restSeconds).toBeGreaterThanOrEqual(0)
    }
    // a stretch is a hold with the authored holdSeconds and 10s rest
    const stretch = snap.items.find((i) => i.category === 'stretch')
    if (stretch) {
      expect(stretch.timing.kind).toBe('hold')
      expect(stretch.timing.restSeconds).toBe(10)
    }
    // strengthen/activation rest 20s
    const strong = snap.items.find((i) => i.category === 'strengthen' || i.category === 'activation')
    if (strong) expect(strong.timing.restSeconds).toBe(20)
  })

  it('omits items whose dose is null for the week (Connect only exists in week 3)', () => {
    const w1 = generateWorkoutSession(report(), { week: 1 })!
    expect(w1.items.every((i) => !i.isIntegrative)).toBe(true)
    const w3 = generateWorkoutSession(report(), { week: 3 })!
    // week 3 may include a Connect item if the report has one
    const hasConnect = report().priorities.some((p) => p.hasConnect)
    expect(w3.items.some((i) => i.isIntegrative)).toBe(hasConnect)
  })

  it('dedups an exercise selected by two priorities (first band/priority wins)', () => {
    const snap = generateWorkoutSession(report(), { week: 1 })!
    const slugs = snap.items.map((i) => i.slug)
    expect(new Set(slugs).size).toBe(slugs.length)
  })

  it('computes a positive estimated duration that grows with more work', () => {
    const w1 = generateWorkoutSession(report(), { week: 1 })!
    const w3 = generateWorkoutSession(report(), { week: 3 })!
    expect(w1.estimatedDurationSec).toBeGreaterThan(0)
    // week 3 ramps sets/reps up (and may add Connect) — never shorter than week 1
    expect(w3.estimatedDurationSec).toBeGreaterThanOrEqual(w1.estimatedDurationSec)
  })

  it('returns null when there is nothing playable (empty-session floor)', () => {
    const empty = buildProgramFrom([], 'S')
    expect(generateWorkoutSession(empty, { week: 1 })).toBeNull()
    const unreliableOnly = buildProgramFrom(
      [finding({ key: 'forward_head_posture', region: 'head_shoulders', zone: 'unreliable', severityPct: 0 })],
      'S',
    )
    expect(generateWorkoutSession(unreliableOnly, { week: 1 })).toBeNull()
  })

  it('is deterministic and pure (same report → same snapshot; report not mutated)', () => {
    const r = report()
    const frozen = JSON.stringify(r)
    const a = generateWorkoutSession(r, { week: 2 })
    const b = generateWorkoutSession(r, { week: 2 })
    expect(a).toEqual(b)
    expect(JSON.stringify(r)).toBe(frozen)
  })

  it('golden snapshot — week 1 session from the canonical two-priority report', () => {
    const snap = generateWorkoutSession(report(), { week: 1 }) as SessionSnapshot
    expect(snap).toMatchSnapshot()
  })
})

describe('content field passthrough', () => {
  test('every session item mirrors its content exercise media/form/steps', () => {
    const snap = generateWorkoutSession(report(), { week: 1 }) // `report` = the file's existing fixture
    expect(snap).not.toBeNull()
    for (const item of snap!.items) {
      const ex = ALL_EXERCISES.find((e) => e.slug === item.slug)!
      expect(item.media).toEqual(ex.media)
      expect(item.form).toEqual(ex.form)
      expect(item.steps).toEqual(ex.steps)
    }
  })

  test('session built over anterior_imbalanced_shoulders includes doorway-pec-stretch with steps', () => {
    const aisReport = buildProgramFrom(
      [finding({ key: 'anterior_imbalanced_shoulders', region: 'head_shoulders', zone: 'danger', severityPct: 80 })],
      'C',
    )
    const snap = generateWorkoutSession(aisReport, { week: 1 })
    expect(snap).not.toBeNull()
    const dps = snap!.items.find((i) => i.slug === 'doorway-pec-stretch')
    expect(dps).toBeDefined()
    expect(dps!.steps).toBeDefined()
    expect(dps!.steps!.length).toBeGreaterThanOrEqual(2)
    expect(dps!.form?.alignmentCue).toBeTruthy()
  })
})
