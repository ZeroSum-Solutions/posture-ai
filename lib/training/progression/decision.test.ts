import { describe, expect, it } from 'vitest'
import { createLoadQuantity } from '../quantity'
import { decideStrengthProgression } from './decision'
import type { StrengthExposureV1, StrengthProgressionInputV1 } from './types'
import { ProgressionInputValidationError } from './validation'

const makeLoad = (value: string) => ({
  equipmentId: 'rack-a',
  basis: 'barbell_total' as const,
  quantity: createLoadQuantity({ value, unit: 'kg' }),
})

const baseInput = (): StrengthProgressionInputV1 => ({
  policyVersion: 'strength-progression-v1',
  now: '2026-09-07T18:00:00.000Z',
  executionContext: { kind: 'live' },
  subjectId: 'subject-a',
  sourceProfileRevisionId: 'profile-r1',
  programRevisionId: 'program-r1',
  eligibility: {
    state: 'eligible_general',
    scope: 'supported',
    policyVersion: 'eligibility-v1',
    sourceRevisionId: 'elig-r1',
    source: {
      kind: 'policy_service',
      sourceVersion: 'eligibility-policy-service.v1',
      evaluatedAt: '2026-09-01T00:00:00.000Z',
    },
    effectiveFrom: '2026-09-01T00:00:00.000Z',
    effectiveUntil: '2026-10-01T00:00:00.000Z',
    supersededAt: null,
  },
  prescription: {
    prescriptionId: 'prescription-a',
    prescribedLoad: makeLoad('60'),
    exerciseVersionId: 'back-squat@1',
    equipmentId: 'rack-a',
    loadBasis: 'barbell_total',
    side: 'bilateral',
    rom: 'catalog_default',
    tempo: 'self_selected_controlled',
    prescribedWorkingSets: 3,
    repRange: { min: 6, max: 8 },
    targetRir: { min: 2, max: 3 },
    exposureType: 'standard',
    loadEpoch: 1,
  },
  equipmentInventory: {
    kind: 'barbell',
    equipmentId: 'rack-a',
    unit: 'kg',
    barWeight: '20',
    collarsTotalWeight: '0',
    plates: [
      { value: '20', count: 2 },
      { value: '1.25', count: 2 },
    ],
  },
  exposures: [],
})

function exposure(
  revision: string,
  completedAt: string,
  reps: readonly number[],
  rirs: readonly (number | '6_plus' | 'unknown')[],
): StrengthExposureV1 {
  const input = baseInput()
  return {
    sourceRevisionId: revision,
    executionContext: { kind: 'live' },
    provenance: { kind: 'in_app', sourceVersion: 'training-log.v1' },
    acceptedPrescription: { sourceRevisionId: `accepted-${revision}`, load: makeLoad('60') },
    sessionState: 'completed',
    exerciseState: 'completed',
    syncState: 'acknowledged',
    startedAt: completedAt,
    completedAt,
    omittedExerciseInstanceIds: [],
    comparator: {
      subjectId: input.subjectId,
      exerciseVersionId: input.prescription.exerciseVersionId,
      equipmentId: input.prescription.equipmentId,
      loadBasis: input.prescription.loadBasis,
      side: input.prescription.side,
      rom: input.prescription.rom,
      tempo: input.prescription.tempo,
      prescribedWorkingSets: input.prescription.prescribedWorkingSets,
      repRange: input.prescription.repRange,
      targetRir: input.prescription.targetRir,
      exposureType: input.prescription.exposureType,
      loadEpoch: input.prescription.loadEpoch,
    },
    sets: reps.map((actualReps, index) => ({
      setId: `${revision}-set-${index + 1}`,
      ordinal: index + 1,
      kind: 'working',
      actualReps,
      actualRir: rirs[index],
      load: makeLoad('60'),
      symptom: 'none',
      validity: 'valid',
    })),
  }
}

describe('decideStrengthProgression', () => {
  it('permits same-run synthetic evidence and rejects live or cross-run contamination', () => {
    const context = {
      kind: 'synthetic_simulation' as const,
      simulationRunId: '11111111-1111-4111-8111-111111111111',
      fixtureId: 'starter-v1',
      fixtureHash: 'a'.repeat(64),
      label: 'Practice data' as const,
    }
    const first = exposure('log-r1', '2026-09-04T18:00:00.000Z', [8, 8, 8], [2, 2, 2])
    first.executionContext = context
    const synthetic = {
      ...baseInput(),
      executionContext: context,
      eligibility: {
        ...baseInput().eligibility,
        source: {
          kind: 'synthetic_fixture' as const,
          sourceVersion: 'synthetic-eligibility-fixture.v1' as const,
          fixtureId: 'starter-v1',
          label: 'Synthetic starter eligibility',
        },
      },
      exposures: [first],
    }
    expect(decideStrengthProgression(synthetic)).toMatchObject({ executionContext: context })
    expect(() => decideStrengthProgression({ ...synthetic, executionContext: { ...context, simulationRunId: '22222222-2222-4222-8222-222222222222' } }))
      .toThrow()
    expect(() => decideStrengthProgression({ ...synthetic, executionContext: { kind: 'live' } })).toThrow()
  })
  it('proposes the smallest achievable load after two same-load ceiling successes', () => {
    const input = {
      ...baseInput(),
      exposures: [
        exposure('log-r1', '2026-09-04T18:00:00.000Z', [8, 8, 8], [2, 3, 2]),
        exposure('log-r2', '2026-09-06T18:00:00.000Z', [8, 8, 8], [3, 2, 3]),
      ],
    }

    const decision = decideStrengthProgression(input)

    expect(decision).toMatchObject({
      kind: 'load_proposal',
      status: 'proposed',
      subjectId: 'subject-a',
      prescriptionId: 'prescription-a',
      exerciseVersionId: 'back-squat@1',
      equipmentId: 'rack-a',
      loadBasis: 'barbell_total',
      programRevisionId: 'program-r1',
      sourceProfileRevisionId: 'profile-r1',
      sourceEligibilityRevisionId: 'elig-r1',
      reasonCodes: ['two_ceiling_successes'],
      sourceExposureRevisionIds: ['log-r1', 'log-r2'],
      proposal: {
        load: makeLoad('62.5'),
        targetReps: [6, 6, 6],
      },
    })
    expect(decision.policyVersion).toBe('strength-progression-v1')
    expect(decision.decisionKey).toMatch(/^strength-progression-v1:sha256:[a-f0-9]{64}$/)
    expect(input.exposures[0].sets[0].load.quantity.entered.value).toBe('60')
  })

  it('uses the latest qualifying exposure for one-rep progression', () => {
    const input = {
      ...baseInput(),
      exposures: [
        exposure('log-r1', '2026-09-04T18:00:00.000Z', [8, 8, 8], [2, 2, 2]),
        exposure('log-r2', '2026-09-06T18:00:00.000Z', [8, 8, 7], [2, 2, 2]),
      ],
    }

    expect(decideStrengthProgression(input)).toMatchObject({
      kind: 'rep_proposal',
      reasonCodes: ['one_rep_progression'],
      sourceExposureRevisionIds: ['log-r2'],
      proposal: { load: makeLoad('60'), targetReps: [8, 8, 8] },
    })
  })

  it('allows the rep branch from the first valid exposure at a new load', () => {
    const input = {
      ...baseInput(),
      prescription: { ...baseInput().prescription, loadEpoch: 2 },
      exposures: [exposure('log-r3', '2026-09-06T18:00:00.000Z', [7, 7, 7], [2, 2, 2])],
    }
    input.exposures[0].comparator.loadEpoch = 2

    expect(decideStrengthProgression(input)).toMatchObject({
      kind: 'rep_proposal',
      sourceExposureRevisionIds: ['log-r3'],
      proposal: { targetReps: [8, 7, 7] },
    })
  })

  it('reviews mixed working loads before entering the rep branch', () => {
    const mixed = exposure('log-r2', '2026-09-06T18:00:00.000Z', [7, 7, 7], [2, 2, 2])
    mixed.sets[2].load = makeLoad('62.5')

    expect(decideStrengthProgression({ ...baseInput(), exposures: [mixed] })).toMatchObject({
      kind: 'review',
      reasonCodes: ['mixed_working_load_review'],
      sourceExposureRevisionIds: ['log-r2'],
    })
  })

  it('distinguishes unknown effort from observed 6_plus effort', () => {
    const unknown = exposure('log-unknown', '2026-09-06T18:00:00.000Z', [7, 7, 7], [2, 'unknown', 2])
    const tooEasy = exposure('log-easy', '2026-09-06T18:00:00.000Z', [7, 7, 7], [2, '6_plus', 2])

    expect(decideStrengthProgression({ ...baseInput(), exposures: [unknown] })).toMatchObject({
      kind: 'hold',
      reasonCodes: ['effort_unknown_hold'],
    })
    expect(decideStrengthProgression({ ...baseInput(), exposures: [tooEasy] })).toMatchObject({
      kind: 'recalibrate',
      reasonCodes: ['effort_too_easy_recalibration'],
    })
  })

  it('applies the ordered unknown-effort branch when the same exposure also contains 6_plus', () => {
    const unresolved = exposure('log-unresolved', '2026-09-06T18:00:00.000Z', [8, 8, 8], ['6_plus', 'unknown', 2])

    expect(decideStrengthProgression({ ...baseInput(), exposures: [unresolved] })).toMatchObject({
      kind: 'hold',
      reasonCodes: ['effort_unknown_hold'],
    })
  })

  it('preserves completed instances after explicit terminal omissions', () => {
    const first = exposure('log-r1', '2026-09-04T18:00:00.000Z', [8, 8, 8], [2, 2, 2])
    const second = exposure('log-r2', '2026-09-06T18:00:00.000Z', [8, 8, 8], [2, 2, 2])
    second.sessionState = 'completed_with_omissions'
    second.omittedExerciseInstanceIds = ['accessory-instance']

    expect(decideStrengthProgression({ ...baseInput(), exposures: [first, second] })).toMatchObject({
      kind: 'load_proposal',
      reasonCodes: ['two_ceiling_successes'],
    })
  })

  it.each([
    ['in_progress', 'session_in_progress_hold'],
    ['aborted', 'session_aborted_hold'],
  ] as const)('holds every series for a %s session', (sessionState, reasonCode) => {
    const latest = exposure('log-r2', '2026-09-07T17:00:00.000Z', [8, 8, 8], [2, 2, 2])
    latest.sessionState = sessionState
    latest.completedAt = null

    expect(decideStrengthProgression({ ...baseInput(), exposures: [latest] })).toMatchObject({
      kind: 'hold',
      reasonCodes: [reasonCode],
    })
  })

  it.each(['outside_release', 'unanswered'] as const)('fails closed for %s eligibility scope', scope => {
    const input = baseInput()
    input.eligibility.scope = scope

    expect(decideStrengthProgression(input)).toMatchObject({
      kind: 'stop', reasonCodes: ['eligibility_scope_unavailable'],
    })
  })

  it('holds an incomplete exercise instance without rewriting other series', () => {
    const latest = exposure('log-r2', '2026-09-06T18:00:00.000Z', [8, 8], [2, 2])
    latest.exerciseState = 'incomplete'

    expect(decideStrengthProgression({ ...baseInput(), exposures: [latest] })).toMatchObject({
      kind: 'hold',
      reasonCodes: ['exercise_incomplete_hold'],
    })
  })

  it('blocks conflicted evidence and an adverse movement symptom', () => {
    const conflicted = exposure('log-conflict', '2026-09-06T18:00:00.000Z', [8, 8, 8], [2, 2, 2])
    conflicted.syncState = 'conflicted'
    const symptomatic = exposure('log-symptom', '2026-09-06T18:00:00.000Z', [8, 8, 8], [2, 2, 2])
    symptomatic.sets[1].symptom = 'adverse'

    expect(decideStrengthProgression({ ...baseInput(), exposures: [conflicted] })).toMatchObject({
      kind: 'hold', reasonCodes: ['sync_conflict_hold'],
    })
    expect(decideStrengthProgression({ ...baseInput(), exposures: [symptomatic] })).toMatchObject({
      kind: 'hold', reasonCodes: ['adverse_symptom_hold'],
    })
  })

  it('gives a movement symptom precedence over unfinished session state', () => {
    const symptomatic = exposure('log-symptom', '2026-09-07T17:00:00.000Z', [8, 8, 8], [2, 2, 2])
    symptomatic.sessionState = 'in_progress'
    symptomatic.completedAt = null
    symptomatic.sets[0].symptom = 'adverse'

    expect(decideStrengthProgression({ ...baseInput(), exposures: [symptomatic] })).toMatchObject({
      kind: 'hold', reasonCodes: ['adverse_symptom_hold'],
    })
  })

  it('gives an affected-movement symptom precedence over malformed set actuals', () => {
    const symptomatic = exposure('log-symptom', '2026-09-06T18:00:00.000Z', [0, 8, 8], [2, 2, 2])
    symptomatic.sets[0].symptom = 'adverse'

    expect(decideStrengthProgression({ ...baseInput(), exposures: [symptomatic] })).toMatchObject({
      kind: 'hold', reasonCodes: ['adverse_symptom_hold'],
    })
  })

  it.each([
    ['pending', 'sync_pending_hold'],
    ['conflicted', 'sync_conflict_hold'],
  ] as const)('holds %s synchronization evidence with a distinct reason', (syncState, reasonCode) => {
    const latest = exposure('log-sync', '2026-09-06T18:00:00.000Z', [8, 8, 8], [2, 2, 2])
    latest.syncState = syncState

    expect(decideStrengthProgression({ ...baseInput(), exposures: [latest] })).toMatchObject({
      kind: 'hold', reasonCodes: [reasonCode],
    })
  })

  it.each([
    ['omitted', 'exercise_incomplete_hold'],
    ['aborted', 'exercise_aborted_hold'],
  ] as const)('holds only the %s exercise instance with a distinct reason', (exerciseState, reasonCode) => {
    const latest = exposure('log-exercise', '2026-09-06T18:00:00.000Z', [8, 8, 8], [2, 2, 2])
    latest.exerciseState = exerciseState

    expect(decideStrengthProgression({ ...baseInput(), exposures: [latest] })).toMatchObject({
      kind: 'hold', reasonCodes: [reasonCode],
    })
  })

  it('holds invalid actuals with a distinct reason', () => {
    const latest = exposure('log-invalid', '2026-09-06T18:00:00.000Z', [8, 8, 8], [2, 2, 2])
    latest.sets[0].validity = 'invalid'

    expect(decideStrengthProgression({ ...baseInput(), exposures: [latest] })).toMatchObject({
      kind: 'hold', reasonCodes: ['invalid_log_hold'],
    })
  })

  it('uses strict 24-hour stale and inclusive 14-day return boundaries', () => {
    const exact24 = exposure('log-active', '2026-09-06T18:00:00.000Z', [8, 8, 8], [2, 2, 2])
    exact24.sessionState = 'in_progress'
    exact24.completedAt = null
    const over24 = { ...exact24, startedAt: '2026-09-06T17:59:59.999Z' }
    const exact14 = exposure('log-old', '2026-08-24T18:00:00.000Z', [8, 8, 8], [2, 2, 2])

    expect(decideStrengthProgression({ ...baseInput(), exposures: [exact24] })).toMatchObject({
      kind: 'hold', reasonCodes: ['session_in_progress_hold'],
    })
    expect(decideStrengthProgression({ ...baseInput(), exposures: [over24] })).toMatchObject({
      kind: 'review', reasonCodes: ['stale_session_review'],
    })
    expect(decideStrengthProgression({ ...baseInput(), exposures: [exact14] })).toMatchObject({
      kind: 'review', reasonCodes: ['return_after_gap_review'],
    })
  })

  it.each([
    ['symptom', (old: StrengthExposureV1) => { old.sets[0].symptom = 'adverse' }, 'adverse_symptom_hold'],
    ['invalid actual', (old: StrengthExposureV1) => { old.sets[0].validity = 'invalid' }, 'invalid_log_hold'],
    ['unknown effort', (old: StrengthExposureV1) => { old.sets[0].actualRir = 'unknown' }, 'effort_unknown_hold'],
    ['6_plus effort', (old: StrengthExposureV1) => { old.sets[0].actualRir = '6_plus' }, 'effort_too_easy_recalibration'],
    ['mixed loads', (old: StrengthExposureV1) => { old.sets[0].load = makeLoad('55') }, 'mixed_working_load_review'],
  ] as const)('applies the ordered %s branch before return-gap review', (_name, mutate, reasonCode) => {
    const old = exposure('log-old', '2026-08-01T18:00:00.000Z', [8, 8, 8], [2, 2, 2])
    mutate(old)

    expect(decideStrengthProgression({ ...baseInput(), exposures: [old] })).toMatchObject({ reasonCodes: [reasonCode] })
  })

  it('recalibrates a changed comparator instead of borrowing prior evidence', () => {
    const changed = exposure('log-other', '2026-09-06T18:00:00.000Z', [8, 8, 8], [2, 2, 2])
    changed.comparator.exerciseVersionId = 'front-squat@1'

    expect(decideStrengthProgression({ ...baseInput(), exposures: [changed] })).toMatchObject({
      kind: 'recalibrate',
      reasonCodes: ['comparator_changed_recalibration'],
    })
  })

  it('starts a new comparator series before applying the old-series return-gap rule', () => {
    const changed = exposure('log-other', '2026-08-01T18:00:00.000Z', [8, 8, 8], [2, 2, 2])
    changed.comparator.equipmentId = 'rack-b'

    expect(decideStrengthProgression({ ...baseInput(), exposures: [changed] })).toMatchObject({
      kind: 'recalibrate',
      reasonCodes: ['comparator_changed_recalibration'],
    })
  })

  it('holds one difficult exposure and reviews two without inventing a decrement', () => {
    const first = exposure('log-r1', '2026-09-04T18:00:00.000Z', [5, 6, 6], [1, 2, 2])
    const second = exposure('log-r2', '2026-09-06T18:00:00.000Z', [5, 6, 6], [1, 2, 2])

    expect(decideStrengthProgression({ ...baseInput(), exposures: [first] })).toMatchObject({
      kind: 'hold', reasonCodes: ['difficult_exposure_hold'],
    })
    expect(decideStrengthProgression({ ...baseInput(), exposures: [first, second] })).toMatchObject({
      kind: 'review', reasonCodes: ['repeated_difficult_exposure_review'],
    })
  })

  it('holds when no achievable equipment increment fits the five-percent cap', () => {
    const input = baseInput()
    input.equipmentInventory = {
      kind: 'barbell', equipmentId: 'rack-a', unit: 'kg', barWeight: '20', collarsTotalWeight: '0',
      plates: [{ value: '20', count: 2 }, { value: '5', count: 2 }],
    }
    input.exposures = [
      exposure('log-r1', '2026-09-04T18:00:00.000Z', [8, 8, 8], [2, 2, 2]),
      exposure('log-r2', '2026-09-06T18:00:00.000Z', [8, 8, 8], [2, 2, 2]),
    ]

    expect(decideStrengthProgression(input)).toMatchObject({
      kind: 'hold', reasonCodes: ['no_achievable_increment_within_cap'],
    })
  })

  it('requires two ceiling successes at the same exact performed load', () => {
    const first = exposure('log-r1', '2026-09-04T18:00:00.000Z', [8, 8, 8], [2, 2, 2])
    first.sets.forEach(set => { set.load = makeLoad('55') })
    const second = exposure('log-r2', '2026-09-06T18:00:00.000Z', [8, 8, 8], [2, 2, 2])

    expect(decideStrengthProgression({ ...baseInput(), exposures: [first, second] })).toMatchObject({
      kind: 'hold', reasonCodes: ['insufficient_same_load_evidence_hold'],
    })
  })

  it.each([
    ['70', 'recalibrate', 'calibration_required'],
    ['72', 'recalibrate', 'calibration_required'],
    ['73', 'hold', 'unconfirmed_outlier_hold'],
    ['75', 'hold', 'unconfirmed_outlier_hold'],
  ] as const)('computes the voluntary 60 to %s kg actual against the exact 20-percent boundary', (actual, kind, reasonCode) => {
    const prior = exposure('log-r1', '2026-09-04T18:00:00.000Z', [7, 7, 7], [2, 2, 2])
    const latest = exposure('log-r2', '2026-09-06T18:00:00.000Z', [7, 7, 7], [2, 2, 2])
    latest.sets.forEach(set => { set.load = makeLoad(actual) })

    expect(decideStrengthProgression({ ...baseInput(), exposures: [prior, latest] })).toMatchObject({
      kind, reasonCodes: [reasonCode],
    })
  })

  it('accepts an exact outlier acknowledgement only as a named recalibration', () => {
    const prior = exposure('log-r1', '2026-09-04T18:00:00.000Z', [7, 7, 7], [2, 2, 2])
    const latest = exposure('log-r2', '2026-09-06T18:00:00.000Z', [7, 7, 7], [2, 2, 2])
    latest.sets.forEach(set => { set.load = makeLoad('75') })
    latest.outlierAcknowledgement = {
      sourceRevisionId: 'ack-r1',
      priorExposureRevisionId: prior.sourceRevisionId,
      actualExposureRevisionId: latest.sourceRevisionId,
    }

    expect(decideStrengthProgression({ ...baseInput(), exposures: [prior, latest] })).toMatchObject({
      kind: 'recalibrate',
      reasonCodes: ['calibration_required'],
      sourceAcknowledgementRevisionIds: ['ack-r1'],
      sourceExposureRevisionIds: ['log-r1', 'log-r2'],
    })
  })

  it('applies computed unconfirmed-outlier handling before unknown-effort handling', () => {
    const prior = exposure('log-r1', '2026-09-04T18:00:00.000Z', [7, 7, 7], [2, 2, 2])
    const latest = exposure('log-r2', '2026-09-06T18:00:00.000Z', [7, 7, 7], ['unknown', 2, 2])
    latest.sets.forEach(set => { set.load = makeLoad('75') })

    expect(decideStrengthProgression({ ...baseInput(), exposures: [prior, latest] })).toMatchObject({
      kind: 'hold', reasonCodes: ['unconfirmed_outlier_hold'],
    })
  })

  it('requires calibration when an unprescribed positive actual has no positive prior exposure', () => {
    const latest = exposure('log-r1', '2026-09-06T18:00:00.000Z', [7, 7, 7], [2, 2, 2])
    latest.sets.forEach(set => { set.load = makeLoad('75') })

    expect(decideStrengthProgression({ ...baseInput(), exposures: [latest] })).toMatchObject({
      kind: 'recalibrate', reasonCodes: ['calibration_required'],
    })
  })

  it('does not let an unaccepted historical calibration become the trusted outlier baseline', () => {
    const unaccepted = exposure('log-r1', '2026-09-04T18:00:00.000Z', [7, 7, 7], [2, 2, 2])
    unaccepted.sets.forEach(set => { set.load = makeLoad('100') })
    const latest = exposure('log-r2', '2026-09-06T18:00:00.000Z', [7, 7, 7], [2, 2, 2])
    latest.sets.forEach(set => { set.load = makeLoad('101') })

    expect(decideStrengthProgression({ ...baseInput(), exposures: [unaccepted, latest] })).toMatchObject({
      kind: 'recalibrate', reasonCodes: ['calibration_required'],
    })
  })

  it('does not let an unacknowledged historical outlier hide a later outlier', () => {
    const accepted = exposure('log-r1', '2026-09-02T18:00:00.000Z', [7, 7, 7], [2, 2, 2])
    const unacknowledged = exposure('log-r2', '2026-09-04T18:00:00.000Z', [7, 7, 7], [2, 2, 2])
    unacknowledged.sets.forEach(set => { set.load = makeLoad('75') })
    const latest = exposure('log-r3', '2026-09-06T18:00:00.000Z', [7, 7, 7], [2, 2, 2])
    latest.sets.forEach(set => { set.load = makeLoad('76') })

    expect(decideStrengthProgression({ ...baseInput(), exposures: [accepted, unacknowledged, latest] })).toMatchObject({
      kind: 'hold', reasonCodes: ['unconfirmed_outlier_hold'],
    })
  })

  it('stops acute state and fails closed for unconstrained cleared state', () => {
    const acute = baseInput()
    acute.eligibility.state = 'acute_stop'
    const constrained = baseInput()
    constrained.eligibility.state = 'cleared_with_constraints'

    expect(decideStrengthProgression(acute)).toMatchObject({ kind: 'stop', reasonCodes: ['acute_stop'] })
    expect(decideStrengthProgression(constrained)).toMatchObject({
      kind: 'review', reasonCodes: ['eligibility_constraints_unavailable'],
    })
  })

  it.each([
    ['unanswered', 'stop', 'eligibility_unanswered'],
    ['needs_clinical_review', 'review', 'eligibility_review_required'],
  ] as const)('fails closed for %s eligibility', (state, kind, reasonCode) => {
    const input = baseInput()
    input.eligibility.state = state

    expect(decideStrengthProgression(input)).toMatchObject({ kind, reasonCodes: [reasonCode] })
  })

  it('requires calibration when there is no completed in-app exposure', () => {
    expect(decideStrengthProgression(baseInput())).toMatchObject({
      kind: 'recalibrate', reasonCodes: ['calibration_required'], sourceExposureRevisionIds: [],
    })
  })

  it('keeps constrained progression unavailable even with a matching authorization marker', () => {
    const input = baseInput()
    input.eligibility.state = 'cleared_with_constraints'
    input.eligibilityAuthorization = {
      decision: 'authorized',
      subjectId: input.subjectId,
      exerciseVersionId: input.prescription.exerciseVersionId,
      programRevisionId: input.programRevisionId,
      policyVersion: 'eligibility-v1',
      sourceRevisionId: input.eligibility.sourceRevisionId,
      effectiveFrom: '2026-09-01T00:00:00.000Z',
      effectiveUntil: '2026-10-01T00:00:00.000Z',
    }
    input.exposures = [exposure('log-r1', '2026-09-06T18:00:00.000Z', [7, 7, 7], [2, 2, 2])]

    expect(decideStrengthProgression(input)).toMatchObject({
      kind: 'review',
      reasonCodes: ['eligibility_constraints_unavailable'],
    })
  })

  it('requires constrained authorization to match the eligibility source revision', () => {
    const input = baseInput()
    input.eligibility.state = 'cleared_with_constraints'
    input.eligibilityAuthorization = {
      decision: 'authorized',
      subjectId: input.subjectId,
      exerciseVersionId: input.prescription.exerciseVersionId,
      programRevisionId: input.programRevisionId,
      policyVersion: input.eligibility.policyVersion,
      sourceRevisionId: 'different-eligibility-revision',
      effectiveFrom: '2026-09-01T00:00:00.000Z',
      effectiveUntil: '2026-10-01T00:00:00.000Z',
    }
    input.exposures = [exposure('log-r1', '2026-09-06T18:00:00.000Z', [7, 7, 7], [2, 2, 2])]

    expect(decideStrengthProgression(input)).toMatchObject({
      kind: 'review',
      reasonCodes: ['eligibility_constraints_unavailable'],
    })
  })

  it.each([
    ['subject', (input: StrengthProgressionInputV1) => { input.eligibilityAuthorization!.subjectId = 'different-subject' }],
    ['exercise', (input: StrengthProgressionInputV1) => { input.eligibilityAuthorization!.exerciseVersionId = 'different-exercise@1' }],
    ['program', (input: StrengthProgressionInputV1) => { input.eligibilityAuthorization!.programRevisionId = 'different-program' }],
    ['policy', (input: StrengthProgressionInputV1) => { input.eligibilityAuthorization!.policyVersion = 'different-policy' }],
  ] as const)('fails closed when constrained authorization mismatches %s', (_name, mutate) => {
    const input = baseInput()
    input.eligibility.state = 'cleared_with_constraints'
    input.eligibilityAuthorization = {
      decision: 'authorized',
      subjectId: input.subjectId,
      exerciseVersionId: input.prescription.exerciseVersionId,
      programRevisionId: input.programRevisionId,
      policyVersion: input.eligibility.policyVersion,
      sourceRevisionId: input.eligibility.sourceRevisionId,
      effectiveFrom: '2026-09-01T00:00:00.000Z',
      effectiveUntil: '2026-10-01T00:00:00.000Z',
    }
    mutate(input)
    expect(decideStrengthProgression(input)).toMatchObject({
      kind: 'review', reasonCodes: ['eligibility_constraints_unavailable'],
    })
  })

  it('distinguishes an exact upstream block from an absent or expired authorization', () => {
    const input = baseInput()
    input.eligibility.state = 'cleared_with_constraints'
    input.eligibilityAuthorization = {
      decision: 'blocked',
      subjectId: input.subjectId,
      exerciseVersionId: input.prescription.exerciseVersionId,
      programRevisionId: input.programRevisionId,
      policyVersion: input.eligibility.policyVersion,
      sourceRevisionId: input.eligibility.sourceRevisionId,
      effectiveFrom: '2026-09-01T00:00:00.000Z',
      effectiveUntil: input.now,
    }

    expect(decideStrengthProgression(input)).toMatchObject({
      kind: 'review', reasonCodes: ['eligibility_constraints_blocked'],
    })

    input.now = '2026-09-07T18:00:00.001Z'
    expect(decideStrengthProgression(input)).toMatchObject({
      kind: 'review', reasonCodes: ['eligibility_constraints_unavailable'],
    })
  })

  it.each([
    ['unknown eligibility state', (input: StrengthProgressionInputV1) => { input.eligibility.state = 'client_claimed_clear' as never }],
    ['missing exposure array', (input: StrengthProgressionInputV1) => { delete (input as Partial<StrengthProgressionInputV1>).exposures }],
    ['unknown equipment kind', (input: StrengthProgressionInputV1) => { input.equipmentInventory = { kind: 'cable' } as never }],
  ] as const)('rejects %s at the runtime boundary with a stable error type', (_name, mutate) => {
    const input = baseInput()
    mutate(input)

    expect(() => decideStrengthProgression(input)).toThrowError(ProgressionInputValidationError)
  })

  it.each([
    ['equipment ID', (input: StrengthProgressionInputV1) => {
      input.equipmentInventory = { ...input.equipmentInventory, equipmentId: 'rack-b' }
    }],
    ['load basis', (input: StrengthProgressionInputV1) => { input.prescription.loadBasis = 'machine_stack' }],
  ] as const)('rejects a prescription/inventory %s mismatch at the runtime boundary', (_name, mutate) => {
    const input = baseInput()
    mutate(input)

    expect(() => decideStrengthProgression(input)).toThrowError(ProgressionInputValidationError)
  })

  it('rejects inconsistent chronology in any supplied exposure, not only the latest one', () => {
    const invalidOlder = exposure('log-invalid-time', '2026-09-01T18:00:00.000Z', [7, 7, 7], [2, 2, 2])
    invalidOlder.startedAt = '2026-09-02T18:00:00.000Z'
    const validLatest = exposure('log-r2', '2026-09-06T18:00:00.000Z', [7, 7, 7], [2, 2, 2])

    expect(() => decideStrengthProgression({ ...baseInput(), exposures: [invalidOlder, validLatest] }))
      .toThrowError(ProgressionInputValidationError)
  })

  it('replays identical evidence to the same proposal without mutating input', () => {
    const input = {
      ...baseInput(),
      exposures: [
        exposure('log-r1', '2026-09-04T18:00:00.000Z', [8, 8, 8], [2, 2, 2]),
        exposure('log-r2', '2026-09-06T18:00:00.000Z', [8, 8, 8], [2, 2, 2]),
      ],
    }
    const before = JSON.stringify(input)

    expect(decideStrengthProgression(input)).toEqual(decideStrengthProgression(input))
    expect(JSON.stringify(input)).toBe(before)
  })

  it('uses distinct identities for empty-source eligibility and calibration outcomes', () => {
    const calibration = decideStrengthProgression(baseInput())
    const acuteInput = baseInput()
    acuteInput.eligibility.state = 'acute_stop'
    const unansweredInput = baseInput()
    unansweredInput.eligibility.state = 'unanswered'
    const keys = [calibration, decideStrengthProgression(acuteInput), decideStrengthProgression(unansweredInput)]
      .map(decision => decision.decisionKey)
    expect(new Set(keys).size).toBe(3)
  })

  it('changes identity at a temporal gate but not for raw now within the same outcome', () => {
    const recent = exposure('log-r2', '2026-09-06T18:00:00.000Z', [7, 7, 7], [2, 2, 2])
    const first = baseInput()
    first.exposures = [recent]
    const laterSameOutcome = { ...first, now: '2026-09-08T18:00:00.000Z' }
    const atReturnGate = { ...first, now: '2026-09-20T18:00:00.000Z' }

    const before = decideStrengthProgression(first)
    expect(decideStrengthProgression(laterSameOutcome).decisionKey).toBe(before.decisionKey)
    expect(decideStrengthProgression(atReturnGate).decisionKey).not.toBe(before.decisionKey)
  })

  it('excludes recalled and imported rows from the in-app evidence window', () => {
    const recalled = exposure('recalled-r1', '2026-09-04T18:00:00.000Z', [8, 8, 8], [2, 2, 2])
    recalled.provenance = { kind: 'recalled', sourceVersion: 'athlete-recall.v1' }
    const imported = exposure('import-r1', '2026-09-05T18:00:00.000Z', [8, 8, 8], [2, 2, 2])
    imported.provenance = { kind: 'imported', sourceVersion: 'external-history-import.v1' }

    expect(decideStrengthProgression({ ...baseInput(), exposures: [recalled, imported] })).toMatchObject({
      kind: 'recalibrate', reasonCodes: ['calibration_required'], sourceExposureRevisionIds: [],
    })
  })

  it('accepts unique session-global working ordinals after filtering warmups', () => {
    const latest = exposure('log-r2', '2026-09-06T18:00:00.000Z', [7, 7, 7], [2, 2, 2])
    latest.sets.unshift(
      { ...latest.sets[0], setId: 'warmup-1', ordinal: 1, kind: 'warmup' },
      { ...latest.sets[0], setId: 'warmup-2', ordinal: 2, kind: 'warmup' },
    )
    latest.sets.filter(set => set.kind === 'working').forEach((set, index) => { set.ordinal = index + 3 })

    expect(decideStrengthProgression({ ...baseInput(), exposures: [latest] })).toMatchObject({
      kind: 'rep_proposal', reasonCodes: ['one_rep_progression'],
    })
  })

  it('flags a prescribed-equal actual when it exceeds the accepted prior actual by more than 20 percent', () => {
    const input = baseInput()
    input.prescription.prescribedLoad = makeLoad('80')
    const prior = exposure('log-r1', '2026-09-04T18:00:00.000Z', [7, 7, 7], [2, 2, 2])
    const latest = exposure('log-r2', '2026-09-06T18:00:00.000Z', [7, 7, 7], [2, 2, 2])
    latest.sets.forEach(set => { set.load = makeLoad('80') })
    latest.acceptedPrescription.load = makeLoad('80')

    expect(decideStrengthProgression({ ...input, exposures: [prior, latest] })).toMatchObject({
      kind: 'hold', reasonCodes: ['unconfirmed_outlier_hold'],
    })
  })

  it.each([
    ['prescribed load', (input: StrengthProgressionInputV1) => { input.prescription.prescribedLoad = makeLoad('1000.001') }],
    ['actual load', (input: StrengthProgressionInputV1) => {
      input.exposures = [exposure('log-heavy', '2026-09-06T18:00:00.000Z', [7, 7, 7], [2, 2, 2])]
      input.exposures[0].sets[0].load = makeLoad('1000.001')
    }],
    ['inventory load', (input: StrengthProgressionInputV1) => {
      input.equipmentInventory = { ...input.equipmentInventory, barWeight: '1000.001' } as StrengthProgressionInputV1['equipmentInventory']
    }],
  ] as const)('rejects a canonical load above 1000 kg in the %s', (_name, mutate) => {
    const input = baseInput()
    mutate(input)
    expect(() => decideStrengthProgression(input)).toThrowError(ProgressionInputValidationError)
  })

  it('accepts the exact 1000 kg parser boundary without treating it as a suggested dose', () => {
    const input = baseInput()
    input.prescription.prescribedLoad = makeLoad('1000')
    input.equipmentInventory = {
      kind: 'barbell', equipmentId: 'rack-a', unit: 'kg', barWeight: '1000', collarsTotalWeight: '0', plates: [],
    }
    const latest = exposure('log-boundary', '2026-09-06T18:00:00.000Z', [7, 7, 7], [2, 2, 2])
    latest.sets.forEach(set => { set.load = makeLoad('1000') })
    latest.acceptedPrescription.load = makeLoad('1000')
    input.exposures = [latest]

    expect(decideStrengthProgression(input)).toMatchObject({
      kind: 'rep_proposal', reasonCodes: ['one_rep_progression'], proposal: { load: makeLoad('1000') },
    })
  })

  it('keeps single-implement dumbbell progression on the entered implement load', () => {
    const input = baseInput()
    const singleLoad = {
      equipmentId: 'db-a', basis: 'dumbbell_single_implement' as const,
      quantity: createLoadQuantity({ value: '10', unit: 'kg' }),
    }
    input.prescription = {
      ...input.prescription,
      prescribedLoad: singleLoad,
      equipmentId: 'db-a',
      loadBasis: 'dumbbell_single_implement',
    }
    input.equipmentInventory = { kind: 'dumbbell', equipmentId: 'db-a', unit: 'kg', perHandLoads: ['10', '10.5'] }
    const latest = exposure('log-single', '2026-09-06T18:00:00.000Z', [7, 7, 7], [2, 2, 2])
    latest.comparator.equipmentId = 'db-a'
    latest.comparator.loadBasis = 'dumbbell_single_implement'
    latest.sets.forEach(set => { set.load = singleLoad })
    latest.acceptedPrescription.load = singleLoad

    expect(decideStrengthProgression({ ...input, exposures: [latest] })).toMatchObject({
      kind: 'rep_proposal', proposal: { load: singleLoad, targetReps: [8, 7, 7] },
    })
  })

  it('rejects synthetic eligibility in live context and holds inactive trusted decisions', () => {
    const liveWithSynthetic = baseInput()
    liveWithSynthetic.eligibility.source = {
      kind: 'synthetic_fixture', sourceVersion: 'synthetic-eligibility-fixture.v1',
      fixtureId: 'fixture-1', label: 'Synthetic eligibility fixture',
    }
    expect(() => decideStrengthProgression(liveWithSynthetic)).toThrowError(ProgressionInputValidationError)

    const mutations: Array<(input: StrengthProgressionInputV1) => void> = [
      input => { input.eligibility.effectiveUntil = '2026-09-07T17:59:59.999Z' },
      input => { input.eligibility.supersededAt = '2026-09-07T17:00:00.000Z' },
      input => { input.eligibility.effectiveFrom = '2026-09-07T18:00:00.001Z' },
    ]
    for (const mutate of mutations) {
      const input = baseInput()
      mutate(input)
      expect(decideStrengthProgression(input)).toMatchObject({ kind: 'stop', reasonCodes: ['eligibility_source_unavailable'] })
    }
  })

  it('rejects assistance semantics from the resistance-only machine stack contract', () => {
    const input = baseInput()
    input.equipmentInventory = {
      kind: 'machine', equipmentId: 'rack-a', unit: 'kg', stackLoads: ['50'], application: 'assistance',
    } as never
    input.prescription.loadBasis = 'machine_stack'
    input.prescription.prescribedLoad = { ...makeLoad('50'), basis: 'machine_stack' }

    expect(() => decideStrengthProgression(input)).toThrowError(ProgressionInputValidationError)
  })
})
