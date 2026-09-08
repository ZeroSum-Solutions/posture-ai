import { describe, expect, it } from 'vitest'
import { createLoadQuantity } from '../quantity'
import {
  TrainingConditioningSessionPrescriptionV1Schema,
  TrainingSessionPrescriptionV1Schema,
  TrainingSessionStateV1Schema,
} from './session'

const live = { kind: 'live' } as const

function acceptedLoad() {
  return {
    status: 'accepted', acceptanceId: 'accept-1', acceptedAt: '2026-09-08T01:00:00Z',
    acceptedByUserId: 'athlete-1', source: 'equipment_inventory', executionContext: live,
    exerciseInstanceId: 'exercise-1', exerciseVersionId: 'goblet.v1', equipmentId: 'db-set-1',
    provenance: { profileRevisionId: '1', compiledProgramRevisionId: 'compiled-program-1', catalogVersion: 'catalog.v1', catalogOrigin: { kind: 'authored_catalog' } },
    loadBasis: 'dumbbell_single_implement', implementCount: 1,
    holdingConfiguration: 'two_hands_single_implement', quantity: createLoadQuantity({ value: '10', unit: 'kg' }),
  } as const
}

describe('session contracts', () => {
  it('freezes accepted load and source revisions in an immutable start prescription', () => {
    const prescription = {
      schemaVersion: 'training-session-prescription.v1', sessionId: 'session-1', assignmentId: 'assignment-1',
      programRevisionNumber: 1, subjectId: 'subject-1', executionContext: live,
      scheduledLocalDate: '2026-09-08', athleteTimezone: 'America/Los_Angeles', profileRevisionId: '1',
      eligibilitySourceRevisionId: 'eligibility-1', compilerPolicyVersion: 'compiler.v1', catalogVersion: 'catalog.v1',
      catalogOrigin: { kind: 'authored_catalog' }, ruleVersion: 'rules.v1', compiledProgramRevisionId: 'compiled-program-1', exercises: [{
        exerciseInstanceId: 'exercise-1', exerciseVersionId: 'goblet.v1', setIds: ['set-1', 'set-2'],
        repRange: { minimum: 8, maximum: 12 }, targetRir: { minimum: 2, maximum: 3 }, restSeconds: 120,
        progression: {
          progressionSeriesId: 'strength-slot:knee_dominant', side: 'bilateral', rom: 'catalog_default',
          tempo: 'self_selected_controlled', exposureType: 'standard', loadEpoch: 1,
        },
        acceptedInitialLoad: acceptedLoad(),
      }],
    } as const
    expect(TrainingSessionPrescriptionV1Schema.parse(prescription)).toEqual(prescription)
    expect(() => TrainingSessionPrescriptionV1Schema.parse({ ...prescription, exercises: [{ ...prescription.exercises[0], acceptedInitialLoad: { ...acceptedLoad(), exerciseInstanceId: 'other' } }] })).toThrow()
    expect(() => TrainingSessionPrescriptionV1Schema.parse({ ...prescription, exercises: [{ ...prescription.exercises[0], acceptedInitialLoad: { ...acceptedLoad(), provenance: { ...acceptedLoad().provenance, compiledProgramRevisionId: 'other' } } }] })).toThrow()
  })

  it('validates a conditioning start prescription against its parent and context', () => {
    const acceptedBout = {
      status: 'accepted', acceptanceId: 'conditioning-1', acceptedAt: '2026-09-08T01:00:00Z',
      acceptedByUserId: 'athlete-1', executionContext: live, boutId: 'bout-1', modalityId: 'walking.v1',
      scheduledLocalDate: '2026-09-09', athleteTimezone: 'America/Los_Angeles', acceptedDurationSeconds: 600,
      effortCue: 'Maintain the talk test.', source: {
        compiledProgramRevisionId: 'compiled-program-1', compilerPolicyVersion: 'compiler.v1', catalogVersion: 'catalog.v1', catalogOrigin: { kind: 'authored_catalog' },
      },
    } as const
    const prescription = {
      schemaVersion: 'training-conditioning-session-prescription.v1', sessionId: 'conditioning-session-1',
      assignmentId: 'assignment-1', programRevisionNumber: 1, subjectId: 'subject-1', executionContext: live,
      catalogOrigin: { kind: 'authored_catalog' }, compiledProgramRevisionId: 'compiled-program-1', acceptedBout,
    } as const
    expect(TrainingConditioningSessionPrescriptionV1Schema.parse(prescription)).toEqual(prescription)
    expect(() => TrainingConditioningSessionPrescriptionV1Schema.parse({ ...prescription, compiledProgramRevisionId: 'other' })).toThrow()
  })

  it('exposes only the settled session state vocabulary', () => {
    expect(TrainingSessionStateV1Schema.parse({
      schemaVersion: 'training-session-state.v1', sessionId: 'session-1', revision: 1,
      state: 'completed_with_omissions', updatedAt: '2026-09-08T02:00:00Z',
    }).state).toBe('completed_with_omissions')
    expect(() => TrainingSessionStateV1Schema.parse({
      schemaVersion: 'training-session-state.v1', sessionId: 'session-1', revision: 1,
      state: 'skipped', updatedAt: '2026-09-08T02:00:00Z',
    })).toThrow()
  })
})
