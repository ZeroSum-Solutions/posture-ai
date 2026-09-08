import { describe, expect, it } from 'vitest'
import { TrainingCatalogV1Schema } from '../catalog/types'
import { TrainingSessionPrescriptionV1Schema } from '../contracts/session'
import { trainingSessionDisplay } from './session-display'

const authoredCatalog = TrainingCatalogV1Schema.parse({
  schemaVersion: 'training-catalog.v1',
  catalogVersion: 'authored-display-test.v1',
  origin: { kind: 'authored_catalog' },
  exercises: [{
    exerciseId: 'test-squat',
    exerciseVersionId: 'test-squat.v1',
    label: 'Test squat',
    movementPattern: 'knee_dominant',
    role: 'primary',
    preferenceRank: 0,
    lifecycle: 'active',
    contentReviewStatus: 'reviewed',
    mediaStatus: 'reviewed_exact_variant',
    preparationSeconds: 30,
    secondsPerRep: 4,
    textInstruction: 'Use the exact reviewed test instruction.',
    progressionDefaults: {
      side: 'bilateral', rom: 'test_full', tempo: 'test_controlled', exposureType: 'test_standard',
    },
    equipmentCompatibility: [{
      kind: 'dumbbell', basis: 'dumbbell_single_implement',
      implementCount: 1, holdingConfiguration: 'two_hands_single_implement',
      minimumCanonicalKg: '1', maximumCanonicalKg: '50',
    }],
  }],
  conditioningModes: [],
})

const livePrescription = TrainingSessionPrescriptionV1Schema.parse({
  schemaVersion: 'training-session-prescription.v1',
  sessionId: 'session:test:1',
  assignmentId: 'assignment:test:1',
  programRevisionNumber: 1,
  subjectId: 'subject:test:1',
  executionContext: { kind: 'live' },
  scheduledLocalDate: '2026-09-08',
  athleteTimezone: 'UTC',
  profileRevisionId: '1',
  eligibilitySourceRevisionId: 'decision:test:1',
  compilerPolicyVersion: 'compiler.test.v1',
  catalogVersion: 'authored-display-test.v1',
  catalogOrigin: { kind: 'authored_catalog' },
  ruleVersion: 'progression.v1',
  compiledProgramRevisionId: 'compiled:test:1',
  exercises: [{
    exerciseInstanceId: 'exercise-instance:test:1',
    exerciseVersionId: 'test-squat.v1',
    movementPattern: 'knee_dominant',
    setIds: ['set:test:1'],
    repRange: { minimum: 6, maximum: 8 },
    targetRir: { minimum: 2, maximum: 3 },
    restSeconds: 120,
    progression: {
      progressionSeriesId: 'series:test:1',
      side: 'bilateral', rom: 'test_full', tempo: 'test_controlled',
      exposureType: 'test_standard', loadEpoch: 1,
    },
    acceptedInitialLoad: {
      status: 'accepted',
      acceptanceId: 'acceptance:test:1',
      acceptedAt: '2026-09-08T12:00:00.000Z',
      acceptedByUserId: 'user:test:1',
      source: 'equipment_inventory',
      executionContext: { kind: 'live' },
      exerciseInstanceId: 'exercise-instance:test:1',
      exerciseVersionId: 'test-squat.v1',
      equipmentId: 'equipment:test:1',
      loadBasis: 'dumbbell_single_implement',
      implementCount: 1,
      holdingConfiguration: 'two_hands_single_implement',
      provenance: {
        profileRevisionId: '1',
        compiledProgramRevisionId: 'compiled:test:1',
        catalogVersion: 'authored-display-test.v1',
        catalogOrigin: { kind: 'authored_catalog' },
      },
      quantity: { entered: { value: '10', unit: 'kg' }, canonicalKg: '10' },
    },
  }],
})

describe('trainingSessionDisplay', () => {
  it('fails closed for a live prescription when no authored catalog is activated', () => {
    expect(trainingSessionDisplay(livePrescription)).toEqual({
      exerciseDisplay: {},
      conditioningDisplay: null,
    })
  })

  it('resolves live copy only from the explicitly supplied exact catalog version', () => {
    expect(trainingSessionDisplay(livePrescription, [authoredCatalog])).toEqual({
      exerciseDisplay: {
        'exercise-instance:test:1': {
          label: 'Test squat',
          textInstruction: 'Use the exact reviewed test instruction.',
          mediaStatus: 'reviewed_exact_variant',
        },
      },
      conditioningDisplay: null,
    })
    expect(trainingSessionDisplay(livePrescription, [{
      ...authoredCatalog,
      catalogVersion: 'different-authored-version.v1',
    }])).toEqual({ exerciseDisplay: {}, conditioningDisplay: null })
  })
})
