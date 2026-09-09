import { describe, expect, it } from 'vitest'
import { TrainingCatalogV1Schema } from '../catalog/types'
import { SYNTHETIC_SWAP_JOURNEY_CATALOG } from '../catalog/syntheticSwapJourney'
import { TrainingSessionPrescriptionV1Schema } from '../contracts/session'
import { createProgramLiveCatalogRegistry } from '../catalog/liveRegistry'
import { createTrainingCatalogResolver } from '../catalog/contextRegistry'
import { createTrainingLaunchMediaRegistry } from '../media/registry'
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
  conditioningModes: [{
    modalityId: 'test-walking.v1',
    label: 'Test-only reviewed walking',
    preferenceRank: 0,
    lifecycle: 'active',
    contentReviewStatus: 'reviewed',
    effortCue: 'Test-only reviewed effort cue.',
  }],
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

const reviewedMedia = {
  schemaVersion: 'training-launch-media-entry.v1' as const,
  binding: {
    catalogVersion: authoredCatalog.catalogVersion,
    catalogOrigin: authoredCatalog.origin,
    exerciseVersionId: authoredCatalog.exercises[0].exerciseVersionId,
  },
  review: {
    kind: 'qualified_exact_variant' as const,
    reviewRecordId: 'review:test-squat:v1',
    reviewedAt: '2026-09-01T12:00:00Z',
  },
  source: {
    rightsRecordId: 'rights:test-squat:v1',
    provider: 'example-provider',
    assetId: 'asset:test-squat:v1',
    sourcePageUrl: 'https://media.example.test/test-squat',
    author: 'Example Author',
    license: {
      identifier: 'CC-BY-SA-4.0',
      name: 'Creative Commons Attribution-ShareAlike 4.0',
      url: 'https://creativecommons.org/licenses/by-sa/4.0/',
    },
  },
  assets: {
    poster: {
      path: '/training-media/test-squat-v1.webp',
      alt: 'Test squat setup and lowered position.',
      width: 1200,
      height: 630,
    },
  },
  expiresAt: '2026-10-01T00:00:00Z',
}

describe('trainingSessionDisplay', () => {
  it('fails closed for a live prescription when no authored catalog is activated', () => {
    expect(trainingSessionDisplay(livePrescription)).toEqual({
      exerciseDisplay: {},
      conditioningDisplay: null,
    })
  })

  it('resolves live copy only from the explicitly supplied exact catalog version', () => {
    const resolver = createTrainingCatalogResolver(createProgramLiveCatalogRegistry([{
      catalog: authoredCatalog,
      conditioningModalityId: 'test-walking.v1',
    }]))
    expect(trainingSessionDisplay(livePrescription, resolver)).toEqual({
      exerciseDisplay: {
        'exercise-instance:test:1': {
          label: 'Test squat',
          textInstruction: 'Use the exact reviewed test instruction.',
          mediaStatus: 'reviewed_exact_variant',
          media: {
            schemaVersion: 'training-launch-media-projection.v1',
            status: 'missing',
            binding: reviewedMedia.binding,
            reason: 'not_registered',
          },
        },
      },
      conditioningDisplay: null,
    })
    expect(trainingSessionDisplay({
      ...livePrescription,
      catalogVersion: 'different-authored-version.v1',
    }, resolver)).toEqual({ exerciseDisplay: {}, conditioningDisplay: null })
  })

  it('projects media only from the exact authored catalog and exercise version binding', () => {
    const catalogResolver = createTrainingCatalogResolver(createProgramLiveCatalogRegistry([{
      catalog: authoredCatalog,
      conditioningModalityId: 'test-walking.v1',
    }]))
    const mediaRegistry = createTrainingLaunchMediaRegistry([reviewedMedia])

    const display = trainingSessionDisplay(
      livePrescription,
      catalogResolver,
      mediaRegistry,
      '2026-09-09T12:00:00Z',
    )

    expect(display.exerciseDisplay['exercise-instance:test:1']).toMatchObject({
      textInstruction: 'Use the exact reviewed test instruction.',
      media: {
        status: 'available',
        binding: reviewedMedia.binding,
        assets: reviewedMedia.assets,
      },
    })

    const wrongVariantRegistry = createTrainingLaunchMediaRegistry([{
      ...reviewedMedia,
      binding: { ...reviewedMedia.binding, exerciseVersionId: 'test-squat.v2' },
    }])
    expect(trainingSessionDisplay(
      livePrescription,
      catalogResolver,
      wrongVariantRegistry,
      '2026-09-09T12:00:00Z',
    ).exerciseDisplay['exercise-instance:test:1']).toMatchObject({
      textInstruction: 'Use the exact reviewed test instruction.',
      media: {
        status: 'missing',
        reason: 'not_registered',
        binding: reviewedMedia.binding,
      },
    })
  })

  it('retains authored instructions while expired media strips usable assets', () => {
    const catalogResolver = createTrainingCatalogResolver(createProgramLiveCatalogRegistry([{
      catalog: authoredCatalog,
      conditioningModalityId: 'test-walking.v1',
    }]))
    const display = trainingSessionDisplay(
      livePrescription,
      catalogResolver,
      createTrainingLaunchMediaRegistry([reviewedMedia]),
      reviewedMedia.expiresAt,
    ).exerciseDisplay['exercise-instance:test:1']

    expect(display).toMatchObject({
      textInstruction: 'Use the exact reviewed test instruction.',
      media: { status: 'expired', expiredAt: reviewedMedia.expiresAt },
    })
    expect(display?.media).not.toHaveProperty('assets')
  })

  it('returns an explicit missing media projection from the empty production registry', () => {
    const catalogResolver = createTrainingCatalogResolver(createProgramLiveCatalogRegistry([{
      catalog: authoredCatalog,
      conditioningModalityId: 'test-walking.v1',
    }]))
    expect(trainingSessionDisplay(
      livePrescription,
      catalogResolver,
    ).exerciseDisplay['exercise-instance:test:1']?.media).toEqual({
      schemaVersion: 'training-launch-media-projection.v1',
      status: 'missing',
      binding: reviewedMedia.binding,
      reason: 'not_registered',
    })
  })

  it('resolves the replacement label only for the exact swap simulation origin', () => {
    const origin = SYNTHETIC_SWAP_JOURNEY_CATALOG.origin
    if (origin.kind !== 'synthetic_fixture') throw new Error('fixture origin required')
    const context = {
      kind: 'synthetic_simulation' as const,
      simulationRunId: '44444444-4444-4444-8444-444444444444',
      fixtureId: origin.fixtureId,
      fixtureHash: origin.fixtureHash,
      label: 'Practice data' as const,
    }
    const prescription = TrainingSessionPrescriptionV1Schema.parse({
      ...livePrescription,
      executionContext: context,
      catalogVersion: SYNTHETIC_SWAP_JOURNEY_CATALOG.catalogVersion,
      catalogOrigin: origin,
      eligibilitySourceRevisionId: 'simulation:44444444-4444-4444-8444-444444444444',
      exercises: livePrescription.exercises.map(exercise => ({
        ...exercise,
        exerciseVersionId: 'synthetic-neutral-grip-two-dumbbell-floor-press.v1',
        movementPattern: 'push',
        acceptedInitialLoad: {
          ...exercise.acceptedInitialLoad,
          executionContext: context,
          exerciseVersionId: 'synthetic-neutral-grip-two-dumbbell-floor-press.v1',
          provenance: {
            ...exercise.acceptedInitialLoad.provenance,
            catalogVersion: SYNTHETIC_SWAP_JOURNEY_CATALOG.catalogVersion,
            catalogOrigin: origin,
          },
        },
      })),
    })

    expect(trainingSessionDisplay(prescription).exerciseDisplay['exercise-instance:test:1'])
      .toMatchObject({
        label: 'Synthetic neutral-grip two-dumbbell floor press',
        mediaStatus: 'missing',
      })
  })
})
