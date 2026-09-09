import { describe, expect, it } from 'vitest'
import {
  SYNTHETIC_STARTER_CATALOG,
  SYNTHETIC_STARTER_CATALOG_FIXTURE_HASH,
} from '../catalog/syntheticStarter'
import {
  SYNTHETIC_SWAP_JOURNEY_CATALOG,
  SYNTHETIC_SWAP_JOURNEY_CATALOG_FIXTURE_HASH,
} from '../catalog/syntheticSwapJourney'
import {
  SYNTHETIC_CONDITIONING_JOURNEY_CATALOG,
  SYNTHETIC_CONDITIONING_JOURNEY_CATALOG_FIXTURE_HASH,
  SYNTHETIC_CONDITIONING_JOURNEY_FIXTURE_ID,
} from '../catalog/syntheticConditioningJourney'
import {
  SYNTHETIC_BODYWEIGHT_ASSISTANCE_CATALOG,
  SYNTHETIC_BODYWEIGHT_ASSISTANCE_FIXTURE_HASH,
  SYNTHETIC_BODYWEIGHT_ASSISTANCE_FIXTURE_ID,
} from '../catalog/syntheticBodyweightAssistance'
import { TrainingCatalogV1Schema } from '../catalog/types'
import type { AthleteTrainingProfileV1 } from '../contracts/profile'
import { TrainingProgramRevisionV1Schema } from '../contracts/program'
import { createLoadQuantity } from '../quantity'
import {
  ProgramBuildError,
  acceptStoredProgramBuild,
  createStoredProgramBuild,
  createSupabaseProgramBuildDependencies,
  readStoredProgramBuildProjection,
  type ProgramBuildDependencies,
  type ProgramCatalogSelectionV1,
  type ProgramLiveSourceV1,
  type ProgramProfileProjectionV1,
  type ProgramSimulationRunV1,
  type StoredProgramBuildV1,
  type StoredProgramDraftV1,
} from './program-build'

const subjectId = '11111111-1111-4111-8111-111111111111'
const userId = '22222222-2222-4222-8222-222222222222'
const buildId = '33333333-3333-4333-8333-333333333333'
const runId = '44444444-4444-4444-8444-444444444444'
const draftId = '55555555-5555-4555-8555-555555555555'
const now = new Date('2026-09-08T12:00:00.000Z')
const actor = { ok: true, actorKind: 'athlete', userId, subjectId } as const
const liveEligibilitySource: ProgramLiveSourceV1 = {
  kind: 'live',
  subjectId,
  profileRevision: 3,
  eligibilitySourceRevisionId: 'decision:live:test:1',
  policyVersion: 'reviewed-policy.test.v1',
  effectiveFrom: '2026-09-08T11:00:00.000Z',
  effectiveUntil: '2026-09-08T13:00:00.000Z',
}
const authoredTestCatalog = TrainingCatalogV1Schema.parse({
  ...SYNTHETIC_STARTER_CATALOG,
  catalogVersion: 'authored-test-catalog.v1',
  origin: { kind: 'authored_catalog' },
  exercises: SYNTHETIC_STARTER_CATALOG.exercises.map((exercise, index) => ({
    ...exercise,
    label: exercise.label.replace('Synthetic ', 'Test '),
    contentReviewStatus: 'reviewed',
    mediaStatus: 'reviewed_exact_variant',
    progressionDefaults: {
      side: 'bilateral',
      rom: 'test_catalog_default',
      tempo: 'test_controlled',
      exposureType: 'test_standard',
    },
    ...(index === 0 ? { warmupSets: [{ targetReps: 8, load: { value: '5.0', unit: 'kg' as const } }] } : {}),
  })),
  conditioningModes: SYNTHETIC_STARTER_CATALOG.conditioningModes.map(mode => ({
    ...mode,
    label: mode.label.replace('Synthetic ', 'Test '),
    contentReviewStatus: 'reviewed',
  })).concat({
    modalityId: 'test-stationary-cycling.v1', label: 'Test stationary cycling', preferenceRank: 1,
    lifecycle: 'active', contentReviewStatus: 'reviewed', effortCue: 'Test conversational effort',
  }),
})
const authoredBodyweightTestCatalog = TrainingCatalogV1Schema.parse({
  ...SYNTHETIC_BODYWEIGHT_ASSISTANCE_CATALOG,
  catalogVersion: 'authored-bodyweight-test-catalog.v1',
  origin: { kind: 'authored_catalog' },
  exercises: SYNTHETIC_BODYWEIGHT_ASSISTANCE_CATALOG.exercises.map(exercise => ({
    ...exercise,
    contentReviewStatus: 'reviewed',
    mediaStatus: 'reviewed_exact_variant',
  })),
  conditioningModes: SYNTHETIC_BODYWEIGHT_ASSISTANCE_CATALOG.conditioningModes.map(mode => ({
    ...mode,
    contentReviewStatus: 'reviewed',
  })),
})

function profile(overrides: Partial<AthleteTrainingProfileV1> = {}): AthleteTrainingProfileV1 {
  return {
    schemaVersion: 'athlete-training-profile.v1',
    origin: {
      kind: 'synthetic_fixture',
      fixtureId: 'synthetic-starter-catalog.v1',
      label: 'Synthetic private practice profile',
    },
    goal: 'general_fitness', experience: 'beginner', recentConsistency: 'consistent', cycleLengthWeeks: 8,
    strengthDays: ['monday', 'thursday'], localTimezone: 'America/Los_Angeles', sessionTimeBudgetMinutes: 30,
    preferredLoadUnit: 'kg',
    equipmentInventory: [{ kind: 'dumbbell', equipmentId: 'db-set-1', unit: 'kg', perHandLoads: ['5', '10'] }],
    startingHistory: [], ...overrides,
  }
}

function sourceProjection(overrides: Partial<ProgramProfileProjectionV1> = {}): ProgramProfileProjectionV1 {
  return { subjectId, permissions: [], revision: 3, profile: profile(), ...overrides }
}

function liveProfile(overrides: Partial<AthleteTrainingProfileV1> = {}): AthleteTrainingProfileV1 {
  return profile({
    origin: { kind: 'athlete_input' },
    conditioningPreference: {
      schemaVersion: 'conditioning-preference.v1',
      catalogVersion: authoredTestCatalog.catalogVersion,
      preferredModalityIds: ['synthetic-continuous-walking.v1'],
    },
    ...overrides,
  })
}

function setup(projection = sourceProjection()) {
  let currentProjection = projection
  let storedBuild: StoredProgramBuildV1 | null = null
  let storedRun: ProgramSimulationRunV1 | null = { id: runId, subjectId, createdByUserId: userId, fixtureId: 'synthetic-starter-catalog.v1', fixtureHash: SYNTHETIC_STARTER_CATALOG_FIXTURE_HASH, status: 'active', createdAt: now.toISOString(), expiresAt: '2026-09-08T13:00:00.000Z' }
  let storedDraft: StoredProgramDraftV1 | null = null
  let storedLiveSource: ProgramLiveSourceV1 | null = null
  let liveCatalog: ProgramCatalogSelectionV1 | null = null
  let racedDraft: StoredProgramDraftV1 | null = null
  const createdBuilds: StoredProgramBuildV1[] = []
  const createdDrafts: Array<{ program: unknown, selectionHash: string, id: string, sourceBuildId: string }> = []
  const ids = [buildId, draftId]
  const dependencies: ProgramBuildDependencies = {
    now: () => now,
    newId: () => ids.shift() ?? '66666666-6666-4666-8666-666666666666',
    loadCurrentProfile: async requested => requested === subjectId ? currentProjection : null,
    resolveSimulationRun: async requested => storedRun?.subjectId === requested ? storedRun : null,
    resolveLiveSource: async requested => storedLiveSource?.subjectId === requested ? storedLiveSource : null,
    resolveLiveCatalog: () => liveCatalog,
    insertBuild: async (build) => { storedBuild = build; createdBuilds.push(build) },
    loadBuild: async requested => storedBuild?.id === requested ? storedBuild : null,
    loadDraftByBuild: async requested => storedDraft?.sourceBuildId === requested ? storedDraft : null,
    insertDraft: async (draft) => {
      if (racedDraft) {
        storedDraft = racedDraft
        racedDraft = null
        return 'source_build_conflict'
      }
      if (storedDraft) return 'source_build_conflict'
      storedDraft = { id: draft.id, sourceBuildId: draft.sourceBuildId, selectionHash: draft.selectionHash, program: draft.program }
      createdDrafts.push(draft)
      return 'inserted'
    },
  }
  return {
    dependencies, createdBuilds, createdDrafts,
    getBuild: () => storedBuild,
    setBuild: (value: StoredProgramBuildV1) => { storedBuild = value },
    setProfile: (value: ProgramProfileProjectionV1) => { currentProjection = value },
    setRun: (value: ProgramSimulationRunV1) => { storedRun = value },
    setLiveSource: (value: ProgramLiveSourceV1 | null) => { storedLiveSource = value },
    setLiveCatalog: (value: ProgramCatalogSelectionV1 | null) => { liveCatalog = value },
    setDraft: (value: StoredProgramDraftV1) => { storedDraft = value },
    raceOnInsert: (value: StoredProgramDraftV1) => { racedDraft = value },
    getDraft: () => storedDraft,
  }
}

function choices(projection: Awaited<ReturnType<typeof createStoredProgramBuild>>) {
  if (projection.result.kind !== 'draft_program') throw new Error('fixture did not compile')
  const conditioning = new Map<string, { boutId: string, acceptedDurationSeconds: number }>()
  for (const bout of projection.result.weeks.flatMap(week => week.conditioningBouts)) {
    const key = `${bout.weekday}:${bout.modalityId}`
    if (!conditioning.has(key)) conditioning.set(key, { boutId: bout.boutId, acceptedDurationSeconds: 600 })
  }
  return {
    loadChoices: projection.calibrations.map(item => ({ exerciseInstanceId: item.calibration.exerciseInstanceId, optionIndex: 0 })),
    conditioningChoices: [...conditioning.values()],
  }
}

describe('stored training program build', () => {
  it('copies the current profile into a server-owned synthetic context and stores a one-hour build', async () => {
    const harness = setup()
    const result = await createStoredProgramBuild({ subjectId, profileRevision: 3, cycleStartLocalDate: '2026-09-08' }, actor, harness.dependencies)
    expect(result).toMatchObject({ schemaVersion: 'training-build-projection.v1', buildId })
    expect(result.result.kind).toBe('draft_program')
    expect(result.calibrations.map(item => item.exerciseLabel)).toEqual([
      'Synthetic goblet squat', 'Synthetic two-dumbbell Romanian deadlift',
      'Synthetic two-dumbbell floor press', 'Synthetic two-dumbbell unsupported bent-over row',
    ])
    expect(harness.createdBuilds).toHaveLength(1)
    expect(harness.createdBuilds[0]).toMatchObject({ simulationRunId: runId, createdByUserId: userId })
    expect(harness.createdBuilds[0].expiresAt).toBe('2026-09-08T13:00:00.000Z')
    expect(sourceProjection().profile.origin).toEqual(profile().origin)
    if (result.result.kind === 'draft_program') {
      expect(result.result.executionContext).toMatchObject({ kind: 'synthetic_simulation', simulationRunId: runId, label: 'Practice data' })
    }
  })

  it('builds, re-reads, and accepts the exact synthetic bodyweight and assistance fixture', async () => {
    const fixtureProfile = profile({
      origin: {
        kind: 'synthetic_fixture',
        fixtureId: SYNTHETIC_BODYWEIGHT_ASSISTANCE_FIXTURE_ID,
        label: 'Synthetic bodyweight and assistance practice profile',
      },
      equipmentInventory: [
        {
          kind: 'bodyweight_external', equipmentId: 'synthetic-bodyweight-station',
          unit: 'kg', externalLoads: ['0', '5', '10'],
        },
        {
          kind: 'assistance_machine', equipmentId: 'synthetic-assisted-pullup-machine',
          unit: 'kg', assistanceLoads: ['10', '20', '30', '40', '50', '60'],
        },
      ],
    })
    const harness = setup(sourceProjection({ profile: fixtureProfile }))
    harness.setRun({
      id: runId, subjectId, createdByUserId: userId,
      fixtureId: SYNTHETIC_BODYWEIGHT_ASSISTANCE_FIXTURE_ID,
      fixtureHash: SYNTHETIC_BODYWEIGHT_ASSISTANCE_FIXTURE_HASH,
      status: 'active', createdAt: now.toISOString(), expiresAt: '2026-09-08T13:00:00.000Z',
    })

    const projection = await createStoredProgramBuild(
      { subjectId, profileRevision: 3, cycleStartLocalDate: '2026-09-08' },
      actor,
      harness.dependencies,
    )
    expect(projection.result).toMatchObject({
      kind: 'draft_program',
      catalogVersion: SYNTHETIC_BODYWEIGHT_ASSISTANCE_CATALOG.catalogVersion,
    })
    expect(projection.calibrations).toHaveLength(4)
    expect(new Set(projection.calibrations.map(item => item.calibration.loadBasis)))
      .toEqual(new Set(['bodyweight_external', 'machine_assistance']))
    expect(projection.calibrations.every(item => (
      item.calibration.bodyweightAssistancePolicy !== undefined
    ))).toBe(true)

    await expect(readStoredProgramBuildProjection(buildId, actor, harness.dependencies))
      .resolves.toMatchObject({ buildId, calibrations: expect.arrayContaining([
        expect.objectContaining({ calibration: expect.objectContaining({ loadBasis: 'bodyweight_external' }) }),
        expect.objectContaining({ calibration: expect.objectContaining({ loadBasis: 'machine_assistance' }) }),
      ]) })

    await acceptStoredProgramBuild(buildId, choices(projection), actor, harness.dependencies)
    const program = TrainingProgramRevisionV1Schema.parse(harness.createdDrafts[0].program)
    const accepted = program.sessions.flatMap(session => session.exercises)
    expect(accepted.filter(exercise => exercise.acceptedInitialLoad.loadBasis === 'bodyweight_external'))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ acceptedInitialLoad: expect.objectContaining({
          implementCount: 0,
          holdingConfiguration: 'bodyweight_plus_external_load',
          bodyweightAssistancePolicy: expect.objectContaining({
            policyId: 'synthetic-bodyweight-rep-only.v1',
          }),
        }) }),
      ]))
    expect(accepted.filter(exercise => exercise.acceptedInitialLoad.loadBasis === 'machine_assistance'))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ acceptedInitialLoad: expect.objectContaining({
          implementCount: 1,
          holdingConfiguration: 'machine_assistance',
          bodyweightAssistancePolicy: expect.objectContaining({
            policyId: 'synthetic-assistance-rep-only.v1',
          }),
        }) }),
      ]))
  })

  it('does not store a live bodyweight build without a trusted reviewed policy registry', async () => {
    const liveBodyweightProfile = liveProfile({
      equipmentInventory: [
        {
          kind: 'bodyweight_external', equipmentId: 'synthetic-bodyweight-station',
          unit: 'kg', externalLoads: ['0', '5', '10'],
        },
        {
          kind: 'assistance_machine', equipmentId: 'synthetic-assisted-pullup-machine',
          unit: 'kg', assistanceLoads: ['10', '20', '30', '40', '50', '60'],
        },
      ],
      conditioningPreference: {
        schemaVersion: 'conditioning-preference.v1',
        catalogVersion: authoredBodyweightTestCatalog.catalogVersion,
        preferredModalityIds: ['synthetic-continuous-walking.v1'],
      },
    })
    const harness = setup(sourceProjection({ profile: liveBodyweightProfile }))
    harness.setLiveSource(liveEligibilitySource)
    harness.setLiveCatalog({
      catalog: authoredBodyweightTestCatalog,
      conditioningModalityId: 'synthetic-continuous-walking.v1',
    })

    await expect(createStoredProgramBuild(
      { subjectId, profileRevision: 3, cycleStartLocalDate: '2026-09-08' },
      actor,
      harness.dependencies,
    )).rejects.toEqual(new ProgramBuildError('program_build_unavailable'))
    expect(harness.createdBuilds).toHaveLength(0)
  })

  it('builds and re-reads the exact swap-journey fixture without changing exercise selection', async () => {
    const harness = setup()
    harness.setRun({
      id: runId,
      subjectId,
      createdByUserId: userId,
      fixtureId: SYNTHETIC_SWAP_JOURNEY_CATALOG.catalogVersion,
      fixtureHash: SYNTHETIC_SWAP_JOURNEY_CATALOG_FIXTURE_HASH,
      status: 'active',
      createdAt: now.toISOString(),
      expiresAt: '2026-09-08T13:00:00.000Z',
    })

    const projection = await createStoredProgramBuild(
      { subjectId, profileRevision: 3, cycleStartLocalDate: '2026-09-08' },
      actor,
      harness.dependencies,
    )

    expect(projection.result).toMatchObject({
      kind: 'draft_program',
      catalogVersion: 'synthetic-swap-journey-catalog.v1',
      executionContext: {
        kind: 'synthetic_simulation',
        fixtureId: 'synthetic-swap-journey-catalog.v1',
        fixtureHash: SYNTHETIC_SWAP_JOURNEY_CATALOG_FIXTURE_HASH,
      },
    })
    expect(projection.calibrations.map(item => item.exerciseLabel)).toContain(
      'Synthetic two-dumbbell floor press',
    )
    expect(projection.calibrations.map(item => item.exerciseLabel)).not.toContain(
      'Synthetic neutral-grip two-dumbbell floor press',
    )
    await expect(readStoredProgramBuildProjection(buildId, actor, harness.dependencies))
      .resolves.toMatchObject({ buildId })
  })

  it('fails closed for a simulation run outside the exact server catalog registry', async () => {
    const harness = setup()
    harness.setRun({
      id: runId, subjectId, createdByUserId: userId,
      fixtureId: 'synthetic-swap-journey-catalog.v1',
      fixtureHash: 'f'.repeat(64), status: 'active',
      createdAt: now.toISOString(), expiresAt: '2026-09-08T13:00:00.000Z',
    })

    await expect(createStoredProgramBuild(
      { subjectId, profileRevision: 3, cycleStartLocalDate: '2026-09-08' },
      actor,
      harness.dependencies,
    )).rejects.toMatchObject({ code: 'program_build_unavailable' })
    expect(harness.createdBuilds).toHaveLength(0)
  })

  it('honors the first exact synthetic conditioning preference instead of the fixture default', async () => {
    const harness = setup(sourceProjection({ profile: profile({
      origin: {
        kind: 'synthetic_fixture',
        fixtureId: SYNTHETIC_CONDITIONING_JOURNEY_FIXTURE_ID,
        label: 'Synthetic conditioning preference profile',
      },
      conditioningPreference: {
        schemaVersion: 'conditioning-preference.v1',
        catalogVersion: SYNTHETIC_CONDITIONING_JOURNEY_CATALOG.catalogVersion,
        preferredModalityIds: ['synthetic-stationary-cycling.v1', 'synthetic-continuous-walking.v1'],
      },
    }) }))
    harness.setRun({
      id: runId, subjectId, createdByUserId: userId,
      fixtureId: SYNTHETIC_CONDITIONING_JOURNEY_FIXTURE_ID,
      fixtureHash: SYNTHETIC_CONDITIONING_JOURNEY_CATALOG_FIXTURE_HASH,
      status: 'active', createdAt: now.toISOString(), expiresAt: '2026-09-08T13:00:00.000Z',
    })

    const projection = await createStoredProgramBuild(
      { subjectId, profileRevision: 3, cycleStartLocalDate: '2026-09-08' }, actor, harness.dependencies,
    )
    expect(projection.result).toMatchObject({ kind: 'draft_program' })
    if (projection.result.kind !== 'draft_program') throw new Error('fixture did not compile')
    expect(new Set(projection.result.weeks.flatMap(week => week.conditioningBouts)
      .map(bout => bout.modalityId))).toEqual(new Set(['synthetic-stationary-cycling.v1']))
  })

  it('rejects a present synthetic preference whose catalog or modality is stale', async () => {
    for (const conditioningPreference of [{
      schemaVersion: 'conditioning-preference.v1' as const,
      catalogVersion: 'synthetic-conditioning-old.v1',
      preferredModalityIds: ['synthetic-stationary-cycling.v1'],
    }, {
      schemaVersion: 'conditioning-preference.v1' as const,
      catalogVersion: SYNTHETIC_CONDITIONING_JOURNEY_CATALOG.catalogVersion,
      preferredModalityIds: ['synthetic-rowing.v1'],
    }]) {
      const harness = setup(sourceProjection({ profile: profile({
        origin: {
          kind: 'synthetic_fixture',
          fixtureId: SYNTHETIC_CONDITIONING_JOURNEY_FIXTURE_ID,
          label: 'Synthetic conditioning preference profile',
        },
        conditioningPreference,
      }) }))
      harness.setRun({
        id: runId, subjectId, createdByUserId: userId,
        fixtureId: SYNTHETIC_CONDITIONING_JOURNEY_FIXTURE_ID,
        fixtureHash: SYNTHETIC_CONDITIONING_JOURNEY_CATALOG_FIXTURE_HASH,
        status: 'active', createdAt: now.toISOString(), expiresAt: '2026-09-08T13:00:00.000Z',
      })
      await expect(createStoredProgramBuild(
        { subjectId, profileRevision: 3, cycleStartLocalDate: '2026-09-08' }, actor, harness.dependencies,
      )).rejects.toMatchObject({ code: 'program_build_stale' })
    }
  })

  it('resolves the synthetic undulating template server-side and calibrates heavy and volume tracks separately', async () => {
    const harness = setup(sourceProjection({
      profile: profile({
        experience: 'intermediate',
        strengthProgrammingStyle: 'intermediate_undulating',
      }),
    }))
    const projection = await createStoredProgramBuild(
      { subjectId, profileRevision: 3, cycleStartLocalDate: '2026-09-08' },
      actor,
      harness.dependencies,
    )

    expect(projection.result).toMatchObject({
      kind: 'draft_program',
      strengthTemplate: {
        style: 'intermediate_undulating',
        provenance: {
          kind: 'synthetic_fixture', fixtureId: 'synthetic-starter-catalog.v1',
          fixtureHash: SYNTHETIC_STARTER_CATALOG_FIXTURE_HASH, label: 'Practice data',
        },
      },
    })
    expect(projection.calibrations).toHaveLength(8)
    expect(new Set(projection.calibrations.map(item => item.exposureType)))
      .toEqual(new Set(['heavy', 'volume']))
    expect(new Set(projection.calibrations.map(item => item.progressionSeriesId)).size).toBe(8)

    await acceptStoredProgramBuild(buildId, choices(projection), actor, harness.dependencies)
    const program = TrainingProgramRevisionV1Schema.parse(harness.createdDrafts[0].program)
    expect(program).toMatchObject({
      strengthProgrammingStyle: 'intermediate_undulating',
      strengthTemplate: { templateVersion: 'intermediate-undulating.v1' },
    })
    const tracked = program.sessions.flatMap(session => session.exercises)
    expect(new Set(tracked.map(exercise => exercise.progression?.exposureType)))
      .toEqual(new Set(['heavy', 'volume']))
    expect(new Set(tracked.filter(exercise => exercise.movementPattern === 'knee_dominant')
      .map(exercise => exercise.progression?.progressionSeriesId)))
      .toEqual(new Set(['strength-slot:knee_dominant:heavy', 'strength-slot:knee_dominant:volume']))
  })

  it('canonicalizes an explicit repeatable preference to the legacy-compatible program shape', async () => {
    const harness = setup(sourceProjection({
      profile: profile({ strengthProgrammingStyle: 'repeatable' }),
    }))
    const projection = await createStoredProgramBuild(
      { subjectId, profileRevision: 3, cycleStartLocalDate: '2026-09-08' },
      actor,
      harness.dependencies,
    )
    expect(projection.calibrations).toHaveLength(4)
    expect(new Set(projection.calibrations.map(item => item.exposureType)))
      .toEqual(new Set(['standard']))
    await acceptStoredProgramBuild(buildId, choices(projection), actor, harness.dependencies)
    expect(TrainingProgramRevisionV1Schema.parse(harness.createdDrafts[0].program))
      .not.toHaveProperty('strengthProgrammingStyle')
  })

  it('fails closed for live undulating profiles while the reviewed template registry is empty', async () => {
    const harness = setup(sourceProjection({
      profile: liveProfile({
        experience: 'intermediate',
        strengthProgrammingStyle: 'intermediate_undulating',
      }),
    }))
    harness.setLiveSource(liveEligibilitySource)
    harness.setLiveCatalog({
      catalog: authoredTestCatalog,
      conditioningModalityId: 'synthetic-continuous-walking.v1',
    })

    const projection = await createStoredProgramBuild(
      { subjectId, profileRevision: 3, cycleStartLocalDate: '2026-09-08' },
      actor,
      harness.dependencies,
    )
    expect(projection).toMatchObject({
      buildId: null,
      result: { kind: 'needs_template_adjustment', reason: 'strength_template_unavailable' },
      calibrations: [],
    })
    expect(harness.createdBuilds).toHaveLength(0)
  })

  it.each([4, 6, 12] as const)(
    'previews and accepts an explicit %s-week cycle without substituting an eight-week horizon',
    async (cycleLengthWeeks) => {
      const harness = setup(sourceProjection({ profile: profile({ cycleLengthWeeks }) }))
      const projection = await createStoredProgramBuild(
        { subjectId, profileRevision: 3, cycleStartLocalDate: '2026-09-08' },
        actor,
        harness.dependencies,
      )

      expect(projection.result).toMatchObject({
        kind: 'draft_program',
        cycleLengthWeeks,
        compilerPolicyVersion: 'strength-cycle-compiler.v3',
      })
      if (projection.result.kind !== 'draft_program') throw new Error('fixture did not compile')
      expect(projection.result.weeks).toHaveLength(cycleLengthWeeks)
      expect(projection.result.weeks.map(week => week.week))
        .toEqual(Array.from({ length: cycleLengthWeeks }, (_, index) => index + 1))

      await acceptStoredProgramBuild(buildId, choices(projection), actor, harness.dependencies)
      const accepted = TrainingProgramRevisionV1Schema.parse(harness.createdDrafts[0].program)
      expect(accepted.cycleLengthWeeks).toBe(cycleLengthWeeks)
      expect(accepted.sessions).toHaveLength(cycleLengthWeeks * 2)
      expect(accepted.conditioningBouts).toHaveLength(cycleLengthWeeks * 2)
    },
  )

  it('compiles and accepts a live profile only with explicit trusted source and authored catalog fixtures', async () => {
    const harness = setup(sourceProjection({ profile: liveProfile() }))
    harness.setLiveSource(liveEligibilitySource)
    harness.setLiveCatalog({
      catalog: authoredTestCatalog,
      conditioningModalityId: 'synthetic-continuous-walking.v1',
    })
    const projection = await createStoredProgramBuild(
      { subjectId, profileRevision: 3, cycleStartLocalDate: '2026-09-08' },
      actor,
      harness.dependencies,
    )
    expect(projection.result).toMatchObject({
      kind: 'draft_program',
      executionContext: { kind: 'live' },
      catalogVersion: 'authored-test-catalog.v1',
      catalogOrigin: { kind: 'authored_catalog' },
    })
    expect(harness.createdBuilds[0]).toMatchObject({
      simulationRunId: null,
      eligibilitySourceRevisionId: 'decision:live:test:1',
    })
    const accepted = await acceptStoredProgramBuild(
      buildId,
      choices(projection),
      actor,
      harness.dependencies,
    )
    expect(accepted).toEqual({
      schemaVersion: 'training-build-acceptance.v1',
      buildId,
      draftId,
    })
    const program = TrainingProgramRevisionV1Schema.parse(harness.createdDrafts[0].program)
    expect(program).toMatchObject({
      executionContext: { kind: 'live' },
      eligibilitySourceRevisionId: 'decision:live:test:1',
      catalogOrigin: { kind: 'authored_catalog' },
      programMode: 'self_directed',
    })
    expect(program.sessions[0].exercises[0].warmupSets).toEqual([{
      setId: expect.stringMatching(/^set_[a-f0-9]{32}$/),
      targetReps: 8,
      prescribedLoad: createLoadQuantity({ value: '5.0', unit: 'kg' }),
    }])
  })

  it('requires a live preference and compiles the first exact preferred reviewed modality', async () => {
    const missing = setup(sourceProjection({ profile: profile({ origin: { kind: 'athlete_input' } }) }))
    missing.setLiveSource(liveEligibilitySource)
    missing.setLiveCatalog({ catalog: authoredTestCatalog, conditioningModalityId: 'synthetic-continuous-walking.v1' })
    await expect(createStoredProgramBuild(
      { subjectId, profileRevision: 3, cycleStartLocalDate: '2026-09-08' }, actor, missing.dependencies,
    )).rejects.toMatchObject({ code: 'program_build_unavailable' })

    const preferred = setup(sourceProjection({ profile: liveProfile({
      conditioningPreference: {
        schemaVersion: 'conditioning-preference.v1',
        catalogVersion: authoredTestCatalog.catalogVersion,
        preferredModalityIds: ['test-stationary-cycling.v1', 'synthetic-continuous-walking.v1'],
      },
    }) }))
    preferred.setLiveSource(liveEligibilitySource)
    preferred.setLiveCatalog({ catalog: authoredTestCatalog, conditioningModalityId: 'synthetic-continuous-walking.v1' })
    const projection = await createStoredProgramBuild(
      { subjectId, profileRevision: 3, cycleStartLocalDate: '2026-09-08' }, actor, preferred.dependencies,
    )
    expect(projection.result).toMatchObject({ kind: 'draft_program' })
    if (projection.result.kind !== 'draft_program') throw new Error('fixture did not compile')
    expect(new Set(projection.result.weeks.flatMap(week => week.conditioningBouts)
      .map(bout => bout.modalityId))).toEqual(new Set(['test-stationary-cycling.v1']))
  })

  it('denies a live preference whose catalog or selected modality is stale', async () => {
    for (const conditioningPreference of [{
      schemaVersion: 'conditioning-preference.v1' as const,
      catalogVersion: 'authored-old.v1',
      preferredModalityIds: ['synthetic-continuous-walking.v1'],
    }, {
      schemaVersion: 'conditioning-preference.v1' as const,
      catalogVersion: authoredTestCatalog.catalogVersion,
      preferredModalityIds: ['retired-mode.v1'],
    }]) {
      const harness = setup(sourceProjection({ profile: liveProfile({ conditioningPreference }) }))
      harness.setLiveSource(liveEligibilitySource)
      harness.setLiveCatalog({ catalog: authoredTestCatalog, conditioningModalityId: 'synthetic-continuous-walking.v1' })
      await expect(createStoredProgramBuild(
        { subjectId, profileRevision: 3, cycleStartLocalDate: '2026-09-08' }, actor, harness.dependencies,
      )).rejects.toMatchObject({ code: 'program_build_stale' })
    }
  })

  it('leaves real profiles unavailable when the trusted authored catalog registry is empty', async () => {
    const harness = setup(sourceProjection({ profile: liveProfile() }))
    harness.setLiveSource(liveEligibilitySource)
    await expect(createStoredProgramBuild(
      { subjectId, profileRevision: 3, cycleStartLocalDate: '2026-09-08' },
      actor,
      harness.dependencies,
    )).rejects.toMatchObject({ code: 'program_build_unavailable' })
    expect(harness.createdBuilds).toHaveLength(0)
  })

  it('returns a concrete compiler alternative without persisting a run or build', async () => {
    const harness = setup(sourceProjection({ profile: profile({ strengthDays: ['monday', 'tuesday'] }) }))
    const result = await createStoredProgramBuild({ subjectId, profileRevision: 3, cycleStartLocalDate: '2026-09-08' }, actor, harness.dependencies)
    expect(result).toMatchObject({ schemaVersion: 'training-build-projection.v1', buildId: null, result: { kind: 'schedule_adjustment_required' }, calibrations: [] })
    expect(harness.createdBuilds).toHaveLength(0)
  })

  it('rejects stale profile revisions and unpermissioned practitioner builds', async () => {
    const harness = setup()
    await expect(createStoredProgramBuild({ subjectId, profileRevision: 2, cycleStartLocalDate: '2026-09-08' }, actor, harness.dependencies))
      .rejects.toMatchObject({ code: 'program_build_stale' })
    await expect(createStoredProgramBuild(
      { subjectId, profileRevision: 3, cycleStartLocalDate: '2026-09-08' },
      { ok: true, actorKind: 'practitioner', userId, subjectId: null }, harness.dependencies,
    )).rejects.toMatchObject({ code: 'program_build_forbidden' })
  })

  it('creates a coach-assigned draft only for the exact permissioned practitioner', async () => {
    const harness = setup(sourceProjection({ permissions: ['profile:read', 'program:coach_publish'] }))
    const coach = { ok: true, actorKind: 'practitioner', userId, subjectId: null } as const
    const projection = await createStoredProgramBuild(
      { subjectId, profileRevision: 3, cycleStartLocalDate: '2026-09-08' }, coach, harness.dependencies,
    )
    await acceptStoredProgramBuild(buildId, choices(projection), coach, harness.dependencies)
    const program = TrainingProgramRevisionV1Schema.parse(harness.createdDrafts[0].program)
    expect(program).toMatchObject({
      programMode: 'coach_assigned', owningPractitionerId: userId,
      author: { kind: 'coach', userId },
    })
  })

  it('does not treat coach publish permission as private simulation control', async () => {
    const harness = setup(sourceProjection({ permissions: ['profile:read', 'program:coach_publish'] }))
    const coach = { ok: true, actorKind: 'practitioner', userId, subjectId: null } as const
    const dependencies = { ...harness.dependencies, resolveSimulationRun: async () => null }
    await expect(createStoredProgramBuild({ subjectId, profileRevision: 3, cycleStartLocalDate: '2026-09-08' }, coach, dependencies))
      .rejects.toMatchObject({ code: 'program_build_unavailable' })
    expect(harness.createdBuilds).toHaveLength(0)
  })

  it('recomputes a saved build before presenting it again', async () => {
    const harness = setup()
    await createStoredProgramBuild({ subjectId, profileRevision: 3, cycleStartLocalDate: '2026-09-08' }, actor, harness.dependencies)
    const reread = await readStoredProgramBuildProjection(buildId, actor, harness.dependencies)
    expect(reread.buildId).toBe(buildId)
    expect(reread.calibrations).toHaveLength(4)
    const stored = harness.getBuild() as StoredProgramBuildV1
    harness.setBuild({ ...stored, build: { ...(stored.build as object), catalogVersion: 'forged' } })
    await expect(readStoredProgramBuildProjection(buildId, actor, harness.dependencies))
      .rejects.toMatchObject({ code: 'program_build_unavailable' })
  })

  it('rejects a stored build whose explicit cycle length and week horizon disagree', async () => {
    const harness = setup()
    await createStoredProgramBuild(
      { subjectId, profileRevision: 3, cycleStartLocalDate: '2026-09-08' },
      actor,
      harness.dependencies,
    )
    const stored = harness.getBuild() as StoredProgramBuildV1
    const build = stored.build as Extract<Awaited<ReturnType<typeof createStoredProgramBuild>>['result'], { kind: 'draft_program' }>
    harness.setBuild({ ...stored, build: { ...build, weeks: build.weeks.slice(0, 4) } })

    await expect(readStoredProgramBuildProjection(buildId, actor, harness.dependencies))
      .rejects.toMatchObject({ code: 'program_build_unavailable' })
  })

  it('accepts representative choices once and expands them to every scheduled instance and bout', async () => {
    const harness = setup()
    const projection = await createStoredProgramBuild({ subjectId, profileRevision: 3, cycleStartLocalDate: '2026-09-08' }, actor, harness.dependencies)
    const selection = choices(projection)
    expect(selection.loadChoices).toHaveLength(4)
    expect(selection.conditioningChoices).toHaveLength(2)
    const result = await acceptStoredProgramBuild(buildId, selection, actor, harness.dependencies)
    expect(result).toEqual({ schemaVersion: 'training-build-acceptance.v1', buildId, draftId })
    expect(harness.createdDrafts).toHaveLength(1)
    const program = TrainingProgramRevisionV1Schema.parse(harness.createdDrafts[0].program)
    expect(program.assignmentId.length).toBeLessThanOrEqual(128)
    expect(program.assignmentId).toBe(`assignment:${buildId}`)
    expect(program.profileRevisionId).toBe('3')
    expect(program.compilerPolicyVersion).toBe('strength-cycle-compiler.v3')
    expect(program.cycleLengthWeeks).toBe(8)
    expect(program.eligibilitySourceRevisionId).toBe(`simulation:${runId}`)
    expect(program.programMode).toBe('self_directed')
    expect(program.sessions).toHaveLength(16)
    expect(program.sessions.flatMap(session => session.exercises)).toHaveLength(64)
    expect(new Set(program.sessions.map(session => session.sessionType))).toEqual(new Set(['full_body']))
    expect(new Set(program.sessions.flatMap(session => session.exercises).map(exercise => exercise.movementPattern)))
      .toEqual(new Set(['knee_dominant', 'hinge', 'push', 'pull']))
    expect(program.sessions.flatMap(session => session.exercises).every(exercise => exercise.progression)).toBe(true)
    expect(new Set(program.sessions.flatMap(session => session.exercises)
      .filter(exercise => exercise.exerciseVersionId === 'synthetic-goblet-squat.v1')
      .map(exercise => exercise.progression?.progressionSeriesId))).toEqual(new Set(['strength-slot:knee_dominant']))
    expect(program.conditioningBouts).toHaveLength(16)
    expect(new Set(program.sessions.flatMap(session => session.exercises).map(exercise => exercise.acceptedInitialLoad.acceptanceId)).size).toBe(64)
    expect(program.conditioningBouts.every(bout => bout.acceptedDurationSeconds === 600)).toBe(true)
  })

  it('returns the same draft for an exact retry and conflicts on different choices', async () => {
    const harness = setup()
    const projection = await createStoredProgramBuild({ subjectId, profileRevision: 3, cycleStartLocalDate: '2026-09-08' }, actor, harness.dependencies)
    const selection = choices(projection)
    const first = await acceptStoredProgramBuild(buildId, selection, actor, harness.dependencies)
    expect(await acceptStoredProgramBuild(buildId, selection, actor, harness.dependencies)).toEqual(first)
    await expect(acceptStoredProgramBuild(buildId, {
      ...selection,
      loadChoices: selection.loadChoices.map((choice, index) => index === 0 ? { ...choice, optionIndex: 1 } : choice),
    }, actor, harness.dependencies)).rejects.toMatchObject({ code: 'program_build_selection_conflict' })
  })

  it('rejects missing, duplicate, and unknown representative choices', async () => {
    const harness = setup()
    const projection = await createStoredProgramBuild({ subjectId, profileRevision: 3, cycleStartLocalDate: '2026-09-08' }, actor, harness.dependencies)
    const selection = choices(projection)
    for (const loadChoices of [selection.loadChoices.slice(1), [selection.loadChoices[0], selection.loadChoices[0], ...selection.loadChoices.slice(2)], [{ exerciseInstanceId: 'unknown', optionIndex: 0 }, ...selection.loadChoices.slice(1)]]) {
      await expect(acceptStoredProgramBuild(buildId, { ...selection, loadChoices }, actor, harness.dependencies))
        .rejects.toMatchObject({ code: 'program_build_invalid_selection' })
    }
    await expect(acceptStoredProgramBuild(buildId, {
      ...selection, loadChoices: [{ ...selection.loadChoices[0], optionIndex: 99 }, ...selection.loadChoices.slice(1)],
    }, actor, harness.dependencies)).rejects.toMatchObject({ code: 'program_build_invalid_selection' })
  })

  it('fails closed when the profile changes or the resolved run expires after preview', async () => {
    const harness = setup()
    const projection = await createStoredProgramBuild({ subjectId, profileRevision: 3, cycleStartLocalDate: '2026-09-08' }, actor, harness.dependencies)
    harness.setProfile(sourceProjection({ revision: 4 }))
    await expect(acceptStoredProgramBuild(buildId, choices(projection), actor, harness.dependencies))
      .rejects.toMatchObject({ code: 'program_build_stale' })
    harness.setProfile(sourceProjection())
    harness.setRun({ id: runId, subjectId, createdByUserId: userId, fixtureId: 'synthetic-starter-catalog.v1', fixtureHash: SYNTHETIC_STARTER_CATALOG_FIXTURE_HASH, status: 'active', createdAt: now.toISOString(), expiresAt: now.toISOString() })
    await expect(acceptStoredProgramBuild(buildId, choices(projection), actor, harness.dependencies))
      .rejects.toMatchObject({ code: 'program_build_unavailable' })
  })

  it('re-reads a matching raced draft and never overwrites a conflicting selection', async () => {
    const harness = setup()
    const projection = await createStoredProgramBuild({ subjectId, profileRevision: 3, cycleStartLocalDate: '2026-09-08' }, actor, harness.dependencies)
    const selection = choices(projection)
    const expectedHarness = setup()
    const expectedProjection = await createStoredProgramBuild({ subjectId, profileRevision: 3, cycleStartLocalDate: '2026-09-08' }, actor, expectedHarness.dependencies)
    await acceptStoredProgramBuild(buildId, choices(expectedProjection), actor, expectedHarness.dependencies)
    const raced = expectedHarness.getDraft() as StoredProgramDraftV1
    harness.raceOnInsert(raced)
    expect((await acceptStoredProgramBuild(buildId, selection, actor, harness.dependencies)).draftId).toBe(draftId)

    const conflictHarness = setup()
    const conflictProjection = await createStoredProgramBuild({ subjectId, profileRevision: 3, cycleStartLocalDate: '2026-09-08' }, actor, conflictHarness.dependencies)
    conflictHarness.raceOnInsert({ ...raced, selectionHash: 'f'.repeat(64) })
    await expect(acceptStoredProgramBuild(buildId, choices(conflictProjection), actor, conflictHarness.dependencies))
      .rejects.toBeInstanceOf(ProgramBuildError)
  })

  it('accepts the real profile RPC projection including its hash metadata', async () => {
    const rpc = async () => ({ data: {
      status: 'ok', schemaVersion: 'training-profile-projection.v1', subjectId, clientId: null,
      permissions: ['profile:read', 'profile:write'],
      current: { revision: 3, profileHash: 'a'.repeat(64), hashEncoding: 'postgres-jsonb-text-utf8.v1', profile: profile() },
    }, error: null })
    const dependencies = createSupabaseProgramBuildDependencies({ rpc } as never, {} as never)
    await expect(dependencies.loadCurrentProfile(subjectId)).resolves.toMatchObject({ subjectId, revision: 3, profile: profile() })
  })

  it('strictly consumes the private resolver JSON and maps its stale revision error', async () => {
    const rpc = async () => ({ data: {
      simulationRunId: runId, subjectId, createdByUserId: userId,
      fixtureId: 'synthetic-starter-catalog.v1', fixtureHash: SYNTHETIC_STARTER_CATALOG_FIXTURE_HASH,
      status: 'active', createdAt: now.toISOString(), expiresAt: '2026-09-08T13:00:00.000Z',
    }, error: null })
    const dependencies = createSupabaseProgramBuildDependencies({ rpc } as never, {} as never)
    await expect(dependencies.resolveSimulationRun(subjectId, 3)).resolves.toMatchObject({ id: runId, fixtureHash: SYNTHETIC_STARTER_CATALOG_FIXTURE_HASH })

    const stale = createSupabaseProgramBuildDependencies({ rpc: async () => ({ data: null, error: { code: 'PT409' } }) } as never, {} as never)
    await expect(stale.resolveSimulationRun(subjectId, 2)).rejects.toMatchObject({ code: 'program_build_stale' })
  })

  it('strictly consumes live source evidence and forwards the expected decision revision', async () => {
    const calls: Array<{ name: string, args: unknown }> = []
    const rpc = async (name: string, args: unknown) => {
      calls.push({ name, args })
      return { data: liveEligibilitySource, error: null }
    }
    const dependencies = createSupabaseProgramBuildDependencies(
      { rpc } as never,
      {} as never,
      {
        resolve: version => version === undefined || version === authoredTestCatalog.catalogVersion
          ? {
              catalog: authoredTestCatalog,
              conditioningModalityId: 'synthetic-continuous-walking.v1',
            }
          : null,
      },
    )
    await expect(dependencies.resolveLiveSource(
      subjectId,
      3,
      'decision:live:test:1',
    )).resolves.toEqual(liveEligibilitySource)
    expect(calls).toEqual([{
      name: 'resolve_training_live_program_build_source',
      args: {
        p_subject_id: subjectId,
        p_profile_revision: 3,
        p_expected_eligibility_source_revision_id: 'decision:live:test:1',
      },
    }])
    expect(dependencies.resolveLiveCatalog('authored-test-catalog.v1')?.catalog.catalogVersion)
      .toBe('authored-test-catalog.v1')
  })
})
