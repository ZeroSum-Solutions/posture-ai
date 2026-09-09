import { describe, expect, it } from 'vitest'
import { createLoadQuantity } from '../quantity'
import { decideStrengthProgression } from './decision'
import type { StrengthExposureV1, StrengthProgressionInputV1 } from './types'

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

// Comparison-track contract fixtures; these do not activate an undulating template.
function trackedExposure(id: string, date: string, track: 'heavy' | 'volume') {
  const log = exposure(id, date, track === 'heavy' ? [8, 8, 8] : [12, 12, 12], [2, 2, 2])
  return { ...log, comparator: { ...log.comparator, exposureType: track, repRange: track === 'heavy' ? { min: 6, max: 8 } : { min: 10, max: 12 } } }
}

describe('separate undulating comparison tracks', () => {
  it.each(['heavy', 'volume'] as const)('uses only two matching %s successes despite an interleaved different track', track => {
    const input = baseInput()
    input.prescription = { ...input.prescription, exposureType: track, repRange: track === 'heavy' ? { min: 6, max: 8 } : { min: 10, max: 12 } }
    input.exposures = [
      trackedExposure('same-1', '2026-09-02T18:00:00.000Z', track),
      trackedExposure('other-track', '2026-09-04T18:00:00.000Z', track === 'heavy' ? 'volume' : 'heavy'),
      trackedExposure('same-2', '2026-09-06T18:00:00.000Z', track),
    ]
    const result = decideStrengthProgression(input)
    expect(result).toMatchObject({ kind: 'load_proposal', reasonCodes: ['two_ceiling_successes'], sourceExposureRevisionIds: ['same-1', 'same-2'] })
    if (result.kind === 'load_proposal') expect(result.proposal.targetReps).toEqual(track === 'heavy' ? [6, 6, 6] : [10, 10, 10])
  })
  it('does not count one volume success as a second heavy success', () => {
    const input = baseInput()
    input.prescription = { ...input.prescription, exposureType: 'heavy' }
    input.exposures = [
      trackedExposure('volume-1', '2026-09-04T18:00:00.000Z', 'volume'),
      trackedExposure('heavy-1', '2026-09-06T18:00:00.000Z', 'heavy'),
    ]
    const result = decideStrengthProgression(input)
    expect(result.status).toBe('not_proposed')
    expect(result.reasonCodes).toContain('insufficient_same_load_evidence_hold')
  })
})
