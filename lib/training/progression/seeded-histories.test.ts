import { describe, expect, it } from 'vitest'
import { createLoadQuantity } from '../quantity'
import { decideStrengthProgression } from './decision'
import type { StrengthExposureV1, StrengthProgressionInputV1 } from './types'

const makeLoad = (value: string, unit: 'kg' | 'lb' = 'kg') => ({
  equipmentId: 'rack-a',
  basis: 'barbell_total' as const,
  quantity: createLoadQuantity({ value, unit }),
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


// Fixed held-out seeds. These are software-policy simulations, not outcome evidence.
function random(seed: number) {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 4294967296
  }
}

describe('held-out seeded progression histories', () => {
  it('replays 1,000 histories without unsafe advancement or input mutation', () => {
    const kinds = new Set<string>()
    for (let seed = 1; seed <= 1_000; seed += 1) {
      const next = random(0x5eed0000 + seed)
      const input = baseInput()
      const scenario = seed % 10
      input.subjectId = `simulation-subject-${seed}`
      input.exposures = Array.from({ length: 8 }, (_, index) => {
        const at = new Date(Date.UTC(2026, 8, 6 - (7 - index) * 2, 18)).toISOString()
        const reps = Array.from({ length: 3 }, () => 6 + Math.floor(next() * 3))
        const entry = exposure(`seed-${seed}-revision-${index}`, at, reps, [2, 2, 3])
        entry.comparator.subjectId = input.subjectId
        return entry
      })
      const unit = seed % 2 === 0 ? 'kg' : 'lb'
      const startingLoad = [60, 80, 100][Math.floor(next() * 3)]
      const load = makeLoad(String(startingLoad), unit)
      input.prescription.prescribedLoad = load
      input.equipmentInventory = {
        kind: 'barbell', equipmentId: 'rack-a', unit, barWeight: '20', collarsTotalWeight: '0',
        plates: [{ value: String((startingLoad - 20) / 2), count: 2 }, { value: '1.25', count: 2 }],
      }
      for (const entry of input.exposures) {
        entry.acceptedPrescription.load = load
        for (const set of entry.sets) set.load = load
      }
      const latest = input.exposures[7]
      const prior = input.exposures[6]
      if (scenario === 0) {
        for (const entry of [prior, latest]) for (const set of entry.sets) set.actualReps = 8
      } else if (scenario === 1) {
        latest.syncState = 'pending'
      } else if (scenario === 2) {
        latest.syncState = 'conflicted'
      } else if (scenario === 3) {
        latest.sets[0].symptom = 'adverse'
      } else if (scenario === 4) {
        latest.sets.forEach(set => { set.actualRir = 0 })
      } else if (scenario === 5) {
        latest.sets[0].actualRir = 'unknown'
      } else if (scenario === 6) {
        input.now = '2026-09-21T18:00:00.000Z'
      } else if (scenario === 7) {
        latest.sessionState = 'in_progress'
        latest.completedAt = null
      } else if (scenario === 8) {
        latest.exerciseState = 'incomplete'
        latest.sets.pop()
      }
      const before = JSON.stringify(input)
      const decision = decideStrengthProgression(input)
      expect(decideStrengthProgression(structuredClone(input)), `seed ${seed} replay`).toEqual(decision)
      expect(JSON.stringify(input), `seed ${seed} immutable input`).toBe(before)
      expect(decision.reasonCodes.length, `seed ${seed} explanation`).toBeGreaterThan(0)
      expect(decision.sourceExposureRevisionIds.every(id => input.exposures.some(e => e.sourceRevisionId === id))).toBe(true)
      kinds.add(decision.kind)
      if (scenario >= 1 && scenario <= 8) {
        expect(decision.status, `seed ${seed} unsafe proposal`).toBe('not_proposed')
      }
      if (scenario === 0) {
        expect(decision.kind, `seed ${seed} two successful exposures`).toBe('load_proposal')
      }
      if (decision.status === 'proposed') {
        expect(decision.proposal.targetReps).toHaveLength(3)
        expect(decision.proposal.targetReps.every(reps => Number.isInteger(reps) && reps >= 6 && reps <= 8)).toBe(true)
        if (decision.kind === 'load_proposal') {
          expect(decision.proposal.load).toEqual(makeLoad(String(startingLoad + 2.5), unit))
          expect(decision.proposal.targetReps).toEqual([6, 6, 6])
        } else {
          expect(decision.proposal.load).toEqual(load)
          expect(decision.proposal.targetReps.reduce((a, b) => a + b, 0))
            .toBe(latest.sets.reduce((sum, set) => sum + set.actualReps, 0) + 1)
        }
      }
    }
    expect(kinds.has('load_proposal')).toBe(true)
    expect(kinds.has('rep_proposal')).toBe(true)
    expect(kinds.has('hold')).toBe(true)
    expect(kinds.has('review')).toBe(true)
  })
})
