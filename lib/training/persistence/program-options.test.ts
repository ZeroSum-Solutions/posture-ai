import { describe, expect, it } from 'vitest'
import { SYNTHETIC_STARTER_CATALOG } from '../catalog/syntheticStarter'
import { TrainingCatalogV1Schema } from '../catalog/types'
import type { AthleteTrainingProfileV1 } from '../contracts/profile'
import type { ProgramOptionsDependencies } from './program-options'
import { ProgramOptionsError, readTrainingProgramOptions } from './program-options'

const subjectId = '11111111-1111-4111-8111-111111111111'
const userId = '22222222-2222-4222-8222-222222222222'
const runId = '33333333-3333-4333-8333-333333333333'
const athlete = { ok: true, actorKind: 'athlete', userId, subjectId } as const

const profile = {
  schemaVersion: 'athlete-training-profile.v1', origin: { kind: 'athlete_input' },
  goal: 'strength', experience: 'beginner', recentConsistency: 'intermittent',
  cycleLengthWeeks: 8, strengthDays: ['monday', 'wednesday', 'friday'],
  localTimezone: 'America/Los_Angeles', sessionTimeBudgetMinutes: 45, preferredLoadUnit: 'kg',
  equipmentInventory: [{
    kind: 'dumbbell', equipmentId: 'dumbbells-home', unit: 'kg', perHandLoads: ['5', '10'],
  }],
  startingHistory: [],
} as const satisfies AthleteTrainingProfileV1

const authoredCatalog = TrainingCatalogV1Schema.parse({
  ...SYNTHETIC_STARTER_CATALOG,
  catalogVersion: 'authored-general.v1',
  origin: { kind: 'authored_catalog' },
  exercises: SYNTHETIC_STARTER_CATALOG.exercises.map(exercise => ({
    ...exercise,
    label: exercise.label.replace('Synthetic ', 'Authored '),
    contentReviewStatus: 'reviewed',
    mediaStatus: 'reviewed_exact_variant',
  })),
  conditioningModes: [{
    modalityId: 'walking.v1', label: 'Walking', preferenceRank: 0,
    lifecycle: 'active', contentReviewStatus: 'reviewed', effortCue: 'Conversational effort',
  }, {
    modalityId: 'cycling.v1', label: 'Stationary cycling', preferenceRank: 1,
    lifecycle: 'active', contentReviewStatus: 'reviewed', effortCue: 'Conversational effort',
  }],
})

function dependencies(overrides: Partial<ProgramOptionsDependencies> = {}): ProgramOptionsDependencies {
  return {
    now: () => new Date('2026-09-09T12:00:00.000Z'),
    loadCurrentProfile: async () => ({ subjectId, permissions: [], revision: 4, profile }),
    resolveSimulationRun: async () => null,
    resolveLiveCatalog: () => ({ catalog: authoredCatalog, conditioningModalityId: 'walking.v1' }),
    ...overrides,
  }
}

describe('readTrainingProgramOptions', () => {
  it('projects selectable catalog modes and exact profile equipment choices without eligibility input', async () => {
    const options = await readTrainingProgramOptions({ subjectId, profileRevision: 4 }, athlete, dependencies())

    expect(options.executionContext).toEqual({ kind: 'live' })
    expect(options.conditioningPreference).toEqual({ status: 'required' })
    expect(options.conditioningModes).toEqual([
      { modalityId: 'walking.v1', label: 'Walking' },
      { modalityId: 'cycling.v1', label: 'Stationary cycling' },
    ])
    expect(options.exerciseOptions[0]).toEqual({
      exerciseVersionId: 'synthetic-goblet-squat.v1',
      label: 'Authored goblet squat',
      equipmentOptions: [{
        equipmentId: 'dumbbells-home', basis: 'dumbbell_single_implement', unit: 'kg',
      }],
    })
  })

  it('classifies ready, stale-catalog, and unavailable-mode preferences without rewriting them', async () => {
    const withPreference = (conditioningPreference: AthleteTrainingProfileV1['conditioningPreference']) => dependencies({
      loadCurrentProfile: async () => ({
        subjectId, permissions: [], revision: 4, profile: { ...profile, conditioningPreference },
      }),
    })

    await expect(readTrainingProgramOptions(
      { subjectId, profileRevision: 4 }, athlete,
      withPreference({
        schemaVersion: 'conditioning-preference.v1', catalogVersion: 'authored-general.v1',
        preferredModalityIds: ['cycling.v1', 'walking.v1'],
      }),
    )).resolves.toMatchObject({ conditioningPreference: { status: 'ready' } })

    await expect(readTrainingProgramOptions(
      { subjectId, profileRevision: 4 }, athlete,
      withPreference({
        schemaVersion: 'conditioning-preference.v1', catalogVersion: 'authored-old.v1',
        preferredModalityIds: ['walking.v1'],
      }),
    )).resolves.toMatchObject({ conditioningPreference: { status: 'stale_catalog' } })

    await expect(readTrainingProgramOptions(
      { subjectId, profileRevision: 4 }, athlete,
      withPreference({
        schemaVersion: 'conditioning-preference.v1', catalogVersion: 'authored-general.v1',
        preferredModalityIds: ['swimming.v1'],
      }),
    )).resolves.toMatchObject({
      conditioningPreference: { status: 'unavailable_modality', unavailableModalityIds: ['swimming.v1'] },
    })
  })

  it('rejects a stale revision only after actor authorization', async () => {
    await expect(readTrainingProgramOptions(
      { subjectId, profileRevision: 3 }, athlete, dependencies(),
    )).rejects.toMatchObject({ code: 'program_options_stale' })

    await expect(readTrainingProgramOptions(
      { subjectId, profileRevision: 3 },
      { ok: true, actorKind: 'athlete', userId, subjectId: '44444444-4444-4444-8444-444444444444' },
      dependencies(),
    )).rejects.toMatchObject({ code: 'program_options_forbidden' })
  })

  it('requires profile:read for a coach and exact ownership for a synthetic run', async () => {
    const coach = { ok: true, actorKind: 'practitioner', userId, subjectId: null } as const
    await expect(readTrainingProgramOptions(
      { subjectId, profileRevision: 4 }, coach, dependencies(),
    )).rejects.toMatchObject({ code: 'program_options_forbidden' })

    const syntheticProfile: AthleteTrainingProfileV1 = {
      ...profile,
      origin: {
        kind: 'synthetic_fixture', fixtureId: SYNTHETIC_STARTER_CATALOG.origin.kind === 'synthetic_fixture'
          ? SYNTHETIC_STARTER_CATALOG.origin.fixtureId : 'unreachable',
        label: 'Synthetic profile',
      },
    }
    const syntheticDependencies = dependencies({
      loadCurrentProfile: async () => ({
        subjectId, permissions: ['profile:read'], revision: 4, profile: syntheticProfile,
      }),
      resolveSimulationRun: async () => ({
        id: runId, subjectId, createdByUserId: userId,
        fixtureId: SYNTHETIC_STARTER_CATALOG.origin.kind === 'synthetic_fixture'
          ? SYNTHETIC_STARTER_CATALOG.origin.fixtureId : 'unreachable',
        fixtureHash: SYNTHETIC_STARTER_CATALOG.origin.kind === 'synthetic_fixture'
          ? SYNTHETIC_STARTER_CATALOG.origin.fixtureHash : '0'.repeat(64),
        status: 'active', createdAt: '2026-09-09T10:00:00.000Z', expiresAt: '2026-09-09T18:00:00.000Z',
      }),
    })
    const projection = await readTrainingProgramOptions(
      { subjectId, profileRevision: 4 }, coach, syntheticDependencies,
    )
    expect(projection.executionContext).toMatchObject({
      kind: 'synthetic_simulation', simulationRunId: runId,
    })

    await expect(readTrainingProgramOptions(
      { subjectId, profileRevision: 4 },
      { ...coach, userId: '55555555-5555-4555-8555-555555555555' },
      syntheticDependencies,
    )).rejects.toBeInstanceOf(ProgramOptionsError)
  })
})
