import { isTrainingConflictCode } from '@/lib/training/persistence/conflict'
import { createHash, randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { SYNTHETIC_STARTER_CATALOG, SYNTHETIC_STARTER_CATALOG_FIXTURE_HASH } from '../catalog/syntheticStarter'
import { TrainingCatalogV1Schema, type TrainingCatalogV1 } from '../catalog/types'
import { acceptCompiledExerciseInitialLoad, buildCompiledExerciseInitialLoadCalibration, type InitialLoadCalibrationV1 } from '../contracts/calibration'
import { acceptCompiledConditioningBout } from '../contracts/conditioning'
import { AthleteTrainingProfileV1Schema, type AthleteTrainingProfileV1 } from '../contracts/profile'
import {
  ExecutionContextV1Schema,
  TrainingProgramRevisionV1Schema,
  type AcceptedConditioningBoutV1,
  type AcceptedInitialLoadV1,
  type ExecutionContextV1,
  type TrainingProgramRevisionV1,
} from '../contracts/program'
import { compileEightWeekProgram, type CompilationResultV1 } from '../engine/compileProgram'
import type { TrainingServerActor } from '../access/server-actor'

const uuidSchema = z.string().uuid()
const localDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const positiveRevisionSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
const starterOrigin: Extract<typeof SYNTHETIC_STARTER_CATALOG.origin, { kind: 'synthetic_fixture' }> = (() => {
  const origin = SYNTHETIC_STARTER_CATALOG.origin
  if (origin.kind !== 'synthetic_fixture') throw new Error('Synthetic starter catalog origin is required')
  return origin
})()

export const CreateProgramBuildInputV1Schema = z.object({
  subjectId: uuidSchema,
  profileRevision: positiveRevisionSchema,
  cycleStartLocalDate: localDateSchema,
}).strict()

export const AcceptProgramBuildInputV1Schema = z.object({
  loadChoices: z.array(z.object({
    exerciseInstanceId: z.string().trim().min(1).max(128),
    optionIndex: z.number().int().min(0).max(10_000),
  }).strict()).max(20),
  conditioningChoices: z.array(z.object({
    boutId: z.string().trim().min(1).max(128),
    acceptedDurationSeconds: z.number().int().min(60).max(1_200),
  }).strict()).max(14),
}).strict()

export type CreateProgramBuildInputV1 = z.infer<typeof CreateProgramBuildInputV1Schema>
export type AcceptProgramBuildInputV1 = z.infer<typeof AcceptProgramBuildInputV1Schema>
type DraftProgram = Extract<CompilationResultV1, { kind: 'draft_program' }>
type AllowedActor = Extract<TrainingServerActor, { ok: true }>

export interface ProgramProfileProjectionV1 {
  readonly subjectId: string
  readonly permissions: readonly string[]
  readonly revision: number
  readonly profile: AthleteTrainingProfileV1
}

export interface ProgramSimulationRunV1 {
  readonly id: string
  readonly subjectId: string
  readonly createdByUserId: string
  readonly fixtureId: string
  readonly fixtureHash: string
  readonly status: 'active' | 'ended'
  readonly createdAt: string
  readonly expiresAt: string
}

export interface ProgramLiveSourceV1 {
  readonly kind: 'live'
  readonly subjectId: string
  readonly profileRevision: number
  readonly eligibilitySourceRevisionId: string
  readonly policyVersion: string
  readonly effectiveFrom: string
  readonly effectiveUntil: string | null
}

export interface ProgramCatalogSelectionV1 {
  readonly catalog: TrainingCatalogV1
  readonly conditioningModalityId: string
}

export interface ProgramLiveCatalogRegistryV1 {
  readonly resolve: (catalogVersion?: string) => ProgramCatalogSelectionV1 | null
}

export const EMPTY_PROGRAM_LIVE_CATALOG_REGISTRY: ProgramLiveCatalogRegistryV1 = Object.freeze({
  resolve: () => null,
})

export interface StoredProgramBuildV1 {
  readonly id: string
  readonly subjectId: string
  readonly createdByUserId: string
  readonly profileRevision: number
  readonly simulationRunId: string | null
  readonly eligibilitySourceRevisionId: string | null
  readonly programRevisionId: string
  readonly compilerPolicyVersion: string
  readonly catalogVersion: string
  readonly build: unknown
  readonly createdAt: string
  readonly expiresAt: string
}

export interface StoredProgramDraftV1 {
  readonly id: string
  readonly sourceBuildId: string
  readonly selectionHash: string
  readonly program: unknown
}

export interface ProgramBuildDependencies {
  readonly now: () => Date
  readonly newId?: () => string
  readonly loadCurrentProfile: (subjectId: string) => Promise<ProgramProfileProjectionV1 | null>
  readonly resolveSimulationRun: (subjectId: string, profileRevision: number) => Promise<ProgramSimulationRunV1 | null>
  readonly resolveLiveSource: (
    subjectId: string,
    profileRevision: number,
    expectedEligibilitySourceRevisionId: string | null,
  ) => Promise<ProgramLiveSourceV1 | null>
  readonly resolveLiveCatalog: (catalogVersion?: string) => ProgramCatalogSelectionV1 | null
  readonly insertBuild: (build: StoredProgramBuildV1) => Promise<void>
  readonly loadBuild: (buildId: string) => Promise<StoredProgramBuildV1 | null>
  readonly loadDraftByBuild: (buildId: string) => Promise<StoredProgramDraftV1 | null>
  readonly insertDraft: (draft: {
    readonly id: string
    readonly subjectId: string
    readonly createdByUserId: string
    readonly profileRevision: number
    readonly simulationRunId: string | null
    readonly eligibilitySourceRevisionId: string | null
    readonly sourceBuildId: string
    readonly selectionHash: string
    readonly program: TrainingProgramRevisionV1
    readonly createdAt: string
    readonly expiresAt: string
  }) => Promise<'inserted' | 'source_build_conflict'>
}

export type ProgramBuildErrorCode =
  | 'program_build_unavailable'
  | 'program_build_forbidden'
  | 'program_build_stale'
  | 'program_build_invalid_selection'
  | 'program_build_selection_conflict'
  | 'program_build_persistence_unavailable'

export class ProgramBuildError extends Error {
  constructor(readonly code: ProgramBuildErrorCode, readonly detail?: unknown) {
    super(code)
    this.name = 'ProgramBuildError'
  }
}

export interface ProgramBuildCalibrationV1 {
  readonly exerciseLabel: string
  readonly calibration: InitialLoadCalibrationV1
}

export interface ProgramBuildProjectionV1 {
  readonly schemaVersion: 'training-build-projection.v1'
  readonly buildId: string | null
  readonly result: CompilationResultV1
  readonly calibrations: readonly ProgramBuildCalibrationV1[]
}

export interface ProgramBuildAcceptanceV1 {
  readonly schemaVersion: 'training-build-acceptance.v1'
  readonly buildId: string
  readonly draftId: string
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, canonicalize(nested)]))
  }
  return value
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value))
}

function stableHash(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex')
}

function stableReference(prefix: string, value: unknown): string {
  return `${prefix}_${stableHash(value).slice(0, 32)}`
}

function requireAllowedActor(actor: AllowedActor, profile: ProgramProfileProjectionV1): 'athlete' | 'coach' {
  if (actor.actorKind === 'athlete' && actor.subjectId === profile.subjectId) return 'athlete'
  if (actor.actorKind === 'practitioner'
    && profile.permissions.includes('program:coach_publish')) return 'coach'
  throw new ProgramBuildError('program_build_forbidden')
}

// Private simulation control is checked by resolve_training_program_build_source,
// not by the public coaching-permission enum. Bind that result to this coach too.
function requireCoachRunOwnership(actor: AllowedActor, run: ProgramSimulationRunV1) {
  if (actor.actorKind === 'practitioner' && run.createdByUserId !== actor.userId) {
    throw new ProgramBuildError('program_build_forbidden')
  }
}

function syntheticProfile(source: AthleteTrainingProfileV1): AthleteTrainingProfileV1 {
  return AthleteTrainingProfileV1Schema.parse({
    ...source,
    origin: {
      kind: 'synthetic_fixture', fixtureId: starterOrigin.fixtureId,
      label: 'Synthetic simulation copy of the current training profile',
    },
  })
}

function executionContext(runId: string): ExecutionContextV1 {
  return ExecutionContextV1Schema.parse({
    kind: 'synthetic_simulation', simulationRunId: runId,
    fixtureId: starterOrigin.fixtureId, fixtureHash: starterOrigin.fixtureHash,
    label: 'Practice data',
  })
}

const liveExecutionContext = ExecutionContextV1Schema.parse({ kind: 'live' })

function requireLiveCatalog(
  selection: ProgramCatalogSelectionV1 | null,
  expectedVersion?: string,
): ProgramCatalogSelectionV1 {
  if (!selection) throw new ProgramBuildError('program_build_unavailable')
  const parsed = TrainingCatalogV1Schema.safeParse(selection.catalog)
  if (!parsed.success || parsed.data.origin.kind !== 'authored_catalog'
    || (expectedVersion !== undefined && parsed.data.catalogVersion !== expectedVersion)
    || !parsed.data.conditioningModes.some(mode => mode.modalityId === selection.conditioningModalityId)) {
    throw new ProgramBuildError('program_build_unavailable')
  }
  return { catalog: parsed.data, conditioningModalityId: selection.conditioningModalityId }
}

function compileStoredDraft(
  subjectId: string,
  profileRevision: number,
  programRevisionId: string,
  cycleStartLocalDate: string,
  profile: AthleteTrainingProfileV1,
  context: ExecutionContextV1,
  catalog: TrainingCatalogV1,
  conditioningModalityId: string,
): CompilationResultV1 {
  return compileEightWeekProgram({
    subjectId, profileRevisionId: String(profileRevision), programRevisionId,
    cycleStartLocalDate, conditioningModalityId,
    executionContext: context, profile, catalog,
  })
}

function allExercises(draft: DraftProgram) {
  return draft.weeks.flatMap(week => week.strengthSessions).flatMap(session => session.exercises)
}

function allBouts(draft: DraftProgram) {
  return draft.weeks.flatMap(week => week.conditioningBouts)
}

function exerciseGroupKey(exercise: DraftProgram['weeks'][number]['strengthSessions'][number]['exercises'][number]): string {
  return canonicalJson({
    exerciseVersionId: exercise.exerciseVersionId,
    equipmentId: exercise.equipmentId,
    loadBasis: exercise.loadBasis,
  })
}

function representativeExerciseGroups(draft: DraftProgram) {
  const groups = new Map<string, typeof draft.weeks[number]['strengthSessions'][number]['exercises'][number][]>()
  for (const exercise of allExercises(draft)) {
    const key = exerciseGroupKey(exercise)
    const group = groups.get(key)
    if (group) group.push(exercise)
    else groups.set(key, [exercise])
  }
  return [...groups.values()]
}

function conditioningGroupKey(bout: DraftProgram['weeks'][number]['conditioningBouts'][number]): string {
  return `${bout.weekday}:${bout.modalityId}`
}

function representativeConditioningGroups(draft: DraftProgram) {
  const groups = new Map<string, typeof draft.weeks[number]['conditioningBouts'][number][]>()
  for (const bout of allBouts(draft)) {
    const key = conditioningGroupKey(bout)
    const group = groups.get(key)
    if (group) group.push(bout)
    else groups.set(key, [bout])
  }
  return [...groups.values()]
}

function buildCalibrations(
  draft: DraftProgram,
  profile: AthleteTrainingProfileV1,
  catalog: TrainingCatalogV1,
): ProgramBuildCalibrationV1[] {
  return representativeExerciseGroups(draft).map((group) => {
    const exercise = group[0]
    const catalogExercise = catalog.exercises
      .find(item => item.exerciseVersionId === exercise.exerciseVersionId)
    if (!catalogExercise) throw new ProgramBuildError('program_build_unavailable')
    return {
      exerciseLabel: catalogExercise.label,
      calibration: buildCompiledExerciseInitialLoadCalibration({
        draft, exerciseInstanceId: exercise.exerciseInstanceId,
        catalog, profile,
      }),
    }
  })
}

function validateRun(run: ProgramSimulationRunV1 | null, stored: StoredProgramBuildV1, now: Date): ProgramSimulationRunV1 {
  if (!stored.simulationRunId || stored.eligibilitySourceRevisionId !== null
    || !run || run.id !== stored.simulationRunId || run.subjectId !== stored.subjectId
    || run.status !== 'active'
    || Date.parse(run.expiresAt) <= now.getTime()
    || run.fixtureId !== starterOrigin.fixtureId || run.fixtureHash !== SYNTHETIC_STARTER_CATALOG_FIXTURE_HASH) {
    throw new ProgramBuildError('program_build_unavailable')
  }
  return run
}

function validateLiveSource(
  source: ProgramLiveSourceV1 | null,
  stored: StoredProgramBuildV1,
  now: Date,
): ProgramLiveSourceV1 {
  if (stored.simulationRunId !== null || !stored.eligibilitySourceRevisionId
    || !source || source.subjectId !== stored.subjectId
    || source.profileRevision !== stored.profileRevision
    || source.eligibilitySourceRevisionId !== stored.eligibilitySourceRevisionId
    || Date.parse(source.effectiveFrom) > now.getTime()
    || (source.effectiveUntil !== null && Date.parse(source.effectiveUntil) <= now.getTime())) {
    throw new ProgramBuildError('program_build_unavailable')
  }
  return source
}

function validateStoredBuild(
  stored: StoredProgramBuildV1,
  profile: ProgramProfileProjectionV1,
  compilationProfile: AthleteTrainingProfileV1,
  context: ExecutionContextV1,
  catalogSelection: ProgramCatalogSelectionV1,
  now: Date,
): DraftProgram {
  if (stored.subjectId !== profile.subjectId || stored.profileRevision !== profile.revision
    || Date.parse(stored.expiresAt) <= now.getTime()) throw new ProgramBuildError('program_build_stale')
  const raw = stored.build as { cycleStartLocalDate?: unknown }
  if (!raw || typeof raw !== 'object' || typeof raw.cycleStartLocalDate !== 'string') {
    throw new ProgramBuildError('program_build_unavailable')
  }
  const result = compileStoredDraft(
    stored.subjectId, stored.profileRevision, stored.programRevisionId,
    raw.cycleStartLocalDate, compilationProfile, context,
    catalogSelection.catalog, catalogSelection.conditioningModalityId,
  )
  if (result.kind !== 'draft_program'
    || result.compilerPolicyVersion !== stored.compilerPolicyVersion
    || result.catalogVersion !== stored.catalogVersion
    || canonicalJson(stored.build) !== canonicalJson(result)) {
    throw new ProgramBuildError('program_build_unavailable')
  }
  return result
}

export async function createStoredProgramBuild(
  rawInput: unknown,
  actor: AllowedActor,
  dependencies: ProgramBuildDependencies,
): Promise<ProgramBuildProjectionV1> {
  const input = CreateProgramBuildInputV1Schema.parse(rawInput)
  const profile = await dependencies.loadCurrentProfile(input.subjectId)
  if (!profile) throw new ProgramBuildError('program_build_unavailable')
  requireAllowedActor(actor, profile)
  if (profile.revision !== input.profileRevision) throw new ProgramBuildError('program_build_stale')
  const profileValue = AthleteTrainingProfileV1Schema.parse(profile.profile)
  const now = dependencies.now()
  let simulationRunId: string | null = null
  let eligibilitySourceRevisionId: string | null = null
  let sourceIdentity: string
  let sourceExpiry: number
  let compilationProfile: AthleteTrainingProfileV1
  let context: ExecutionContextV1
  let catalogSelection: ProgramCatalogSelectionV1
  if (profileValue.origin.kind === 'synthetic_fixture') {
    const run = await dependencies.resolveSimulationRun(input.subjectId, input.profileRevision)
    if (!run || run.subjectId !== input.subjectId || run.status !== 'active'
      || Date.parse(run.expiresAt) <= now.getTime()
      || run.fixtureId !== starterOrigin.fixtureId || run.fixtureHash !== starterOrigin.fixtureHash) {
      throw new ProgramBuildError('program_build_unavailable')
    }
    requireCoachRunOwnership(actor, run)
    simulationRunId = run.id
    sourceIdentity = run.id
    sourceExpiry = Date.parse(run.expiresAt)
    compilationProfile = syntheticProfile(profileValue)
    context = executionContext(run.id)
    catalogSelection = {
      catalog: SYNTHETIC_STARTER_CATALOG,
      conditioningModalityId: 'synthetic-continuous-walking.v1',
    }
  } else {
    const source = await dependencies.resolveLiveSource(
      input.subjectId,
      input.profileRevision,
      null,
    )
    if (!source || source.subjectId !== input.subjectId
      || source.profileRevision !== input.profileRevision
      || Date.parse(source.effectiveFrom) > now.getTime()
      || (source.effectiveUntil !== null && Date.parse(source.effectiveUntil) <= now.getTime())) {
      throw new ProgramBuildError('program_build_unavailable')
    }
    catalogSelection = requireLiveCatalog(dependencies.resolveLiveCatalog())
    eligibilitySourceRevisionId = source.eligibilitySourceRevisionId
    sourceIdentity = source.eligibilitySourceRevisionId
    sourceExpiry = source.effectiveUntil === null
      ? Number.POSITIVE_INFINITY
      : Date.parse(source.effectiveUntil)
    compilationProfile = profileValue
    context = liveExecutionContext
  }
  const buildId = (dependencies.newId ?? randomUUID)()
  const programRevisionId = stableReference('build', [
    buildId, input.subjectId, input.profileRevision, sourceIdentity,
    catalogSelection.catalog.catalogVersion,
  ])
  const result = compileStoredDraft(
    input.subjectId, input.profileRevision, programRevisionId,
    input.cycleStartLocalDate, compilationProfile, context,
    catalogSelection.catalog, catalogSelection.conditioningModalityId,
  )
  if (result.kind !== 'draft_program') {
    return { schemaVersion: 'training-build-projection.v1', buildId: null, result, calibrations: [] }
  }
  const expiresAt = new Date(Math.min(now.getTime() + 60 * 60 * 1_000, sourceExpiry)).toISOString()
  const stored: StoredProgramBuildV1 = {
    id: buildId, subjectId: input.subjectId, createdByUserId: actor.userId,
    profileRevision: input.profileRevision, simulationRunId, eligibilitySourceRevisionId,
    programRevisionId, compilerPolicyVersion: result.compilerPolicyVersion,
    catalogVersion: result.catalogVersion, build: result,
    createdAt: now.toISOString(), expiresAt,
  }
  try {
    await dependencies.insertBuild(stored)
  } catch {
    throw new ProgramBuildError('program_build_persistence_unavailable')
  }
  return {
    schemaVersion: 'training-build-projection.v1', buildId,
    result, calibrations: buildCalibrations(result, compilationProfile, catalogSelection.catalog),
  }
}

async function loadAuthorizedBuild(
  buildId: string,
  actor: AllowedActor,
  dependencies: ProgramBuildDependencies,
): Promise<{
  stored: StoredProgramBuildV1
  profile: ProgramProfileProjectionV1
  compilationProfile: AthleteTrainingProfileV1
  catalogSelection: ProgramCatalogSelectionV1
  draft: DraftProgram
}> {
  const parsedId = uuidSchema.parse(buildId)
  const stored = await dependencies.loadBuild(parsedId)
  if (!stored || stored.createdByUserId !== actor.userId) throw new ProgramBuildError('program_build_unavailable')
  const profile = await dependencies.loadCurrentProfile(stored.subjectId)
  if (!profile) throw new ProgramBuildError('program_build_unavailable')
  requireAllowedActor(actor, profile)
  if (profile.revision !== stored.profileRevision) throw new ProgramBuildError('program_build_stale')
  const now = dependencies.now()
  let compilationProfile: AthleteTrainingProfileV1
  let context: ExecutionContextV1
  let catalogSelection: ProgramCatalogSelectionV1
  if (stored.simulationRunId !== null && stored.eligibilitySourceRevisionId === null) {
    const run = validateRun(
      await dependencies.resolveSimulationRun(stored.subjectId, stored.profileRevision),
      stored,
      now,
    )
    requireCoachRunOwnership(actor, run)
    compilationProfile = syntheticProfile(profile.profile)
    context = executionContext(run.id)
    catalogSelection = {
      catalog: SYNTHETIC_STARTER_CATALOG,
      conditioningModalityId: 'synthetic-continuous-walking.v1',
    }
  } else if (stored.simulationRunId === null && stored.eligibilitySourceRevisionId !== null) {
    validateLiveSource(
      await dependencies.resolveLiveSource(
        stored.subjectId,
        stored.profileRevision,
        stored.eligibilitySourceRevisionId,
      ),
      stored,
      now,
    )
    compilationProfile = AthleteTrainingProfileV1Schema.parse(profile.profile)
    if (compilationProfile.origin.kind !== 'athlete_input') {
      throw new ProgramBuildError('program_build_unavailable')
    }
    context = liveExecutionContext
    catalogSelection = requireLiveCatalog(
      dependencies.resolveLiveCatalog(stored.catalogVersion),
      stored.catalogVersion,
    )
  } else {
    throw new ProgramBuildError('program_build_unavailable')
  }
  return {
    stored,
    profile,
    compilationProfile,
    catalogSelection,
    draft: validateStoredBuild(
      stored,
      profile,
      compilationProfile,
      context,
      catalogSelection,
      now,
    ),
  }
}

export async function readStoredProgramBuildProjection(
  buildId: string,
  actor: AllowedActor,
  dependencies: ProgramBuildDependencies,
): Promise<ProgramBuildProjectionV1> {
  const { stored, compilationProfile, catalogSelection, draft } = await loadAuthorizedBuild(
    buildId,
    actor,
    dependencies,
  )
  return {
    schemaVersion: 'training-build-projection.v1', buildId: stored.id,
    result: draft,
    calibrations: buildCalibrations(draft, compilationProfile, catalogSelection.catalog),
  }
}

function requireExactSelections(expected: readonly string[], actual: readonly string[]): void {
  if (actual.length !== expected.length || new Set(actual).size !== actual.length
    || expected.some(id => !actual.includes(id))) {
    throw new ProgramBuildError('program_build_invalid_selection')
  }
}

function assembleProgram(
  stored: StoredProgramBuildV1,
  draft: DraftProgram,
  compilationProfile: AthleteTrainingProfileV1,
  catalog: TrainingCatalogV1,
  actor: AllowedActor,
  input: AcceptProgramBuildInputV1,
  now: Date,
  draftId: string,
  selectionHash: string,
): TrainingProgramRevisionV1 {
  const exerciseGroups = representativeExerciseGroups(draft)
  const exerciseRepresentatives = exerciseGroups.map(group => group[0].exerciseInstanceId)
  requireExactSelections(exerciseRepresentatives, input.loadChoices.map(choice => choice.exerciseInstanceId))
  const loadChoices = new Map(input.loadChoices.map(choice => [choice.exerciseInstanceId, choice.optionIndex]))
  const acceptedLoads = new Map<string, AcceptedInitialLoadV1>()
  for (const group of exerciseGroups) {
    const representative = group[0]
    const optionIndex = loadChoices.get(representative.exerciseInstanceId) as number
    const calibration = buildCompiledExerciseInitialLoadCalibration({
      draft, exerciseInstanceId: representative.exerciseInstanceId,
      catalog, profile: compilationProfile,
    })
    if (!calibration.options[optionIndex]) throw new ProgramBuildError('program_build_invalid_selection')
    for (const exercise of group) {
      acceptedLoads.set(exercise.exerciseInstanceId, acceptCompiledExerciseInitialLoad({
        draft, exerciseInstanceId: exercise.exerciseInstanceId,
        catalog, profile: compilationProfile,
        acceptanceId: stableReference('accept', [selectionHash, exercise.exerciseInstanceId]),
        acceptedAt: now.toISOString(), acceptedByUserId: actor.userId, optionIndex,
      }))
    }
  }

  const boutGroups = representativeConditioningGroups(draft)
  const boutRepresentatives = boutGroups.map(group => group[0].boutId)
  requireExactSelections(boutRepresentatives, input.conditioningChoices.map(choice => choice.boutId))
  const conditioningChoices = new Map(input.conditioningChoices.map(choice => [choice.boutId, choice.acceptedDurationSeconds]))
  const acceptedBouts: AcceptedConditioningBoutV1[] = []
  for (const group of boutGroups) {
    const duration = conditioningChoices.get(group[0].boutId) as number
    for (const bout of group) {
      acceptedBouts.push(acceptCompiledConditioningBout({
        draft, boutId: bout.boutId,
        acceptanceId: stableReference('condition', [selectionHash, bout.boutId]),
        acceptedAt: now.toISOString(), acceptedByUserId: actor.userId,
        acceptedDurationSeconds: duration,
      }))
    }
  }

  const authorKind = actor.actorKind === 'athlete' ? 'athlete' : 'coach'
  const eligibilitySourceRevisionId = stored.simulationRunId === null
    ? stored.eligibilitySourceRevisionId
    : `simulation:${stored.simulationRunId}`
  if (!eligibilitySourceRevisionId) throw new ProgramBuildError('program_build_unavailable')
  return TrainingProgramRevisionV1Schema.parse({
    schemaVersion: 'training-program-revision.v1',
    assignmentId: `assignment:${stored.id}`, revisionNumber: 1,
    subjectId: stored.subjectId,
    programMode: authorKind === 'athlete' ? 'self_directed' : 'coach_assigned',
    owningPractitionerId: authorKind === 'coach' ? actor.userId : null,
    executionContext: draft.executionContext,
    cycleStartLocalDate: draft.cycleStartLocalDate, cycleLengthWeeks: 8,
    profileRevisionId: String(stored.profileRevision),
    eligibilitySourceRevisionId,
    compilerPolicyVersion: draft.compilerPolicyVersion, catalogVersion: draft.catalogVersion,
    catalogOrigin: draft.catalogOrigin, ruleVersion: 'progression.v1',
    compiledProgramRevisionId: draft.programRevisionId,
    publishedAt: now.toISOString(), author: { kind: authorKind, userId: actor.userId },
    sessions: draft.weeks.flatMap(week => week.strengthSessions).map(session => ({
      sessionId: session.sessionId, sessionType: session.sessionType,
      scheduledLocalDate: session.scheduledLocalDate,
      athleteTimezone: session.athleteTimezone,
      exercises: session.exercises.map(exercise => ({
        exerciseInstanceId: exercise.exerciseInstanceId, exerciseVersionId: exercise.exerciseVersionId,
        movementPattern: exercise.movementPattern,
        setIds: [...exercise.setIds], repRange: exercise.repRange,
        targetRir: exercise.targetRir, restSeconds: exercise.restSeconds,
        progression: exercise.progression,
        acceptedInitialLoad: acceptedLoads.get(exercise.exerciseInstanceId),
      })),
    })),
    conditioningBouts: acceptedBouts,
  })
}

export async function acceptStoredProgramBuild(
  buildId: string,
  rawInput: unknown,
  actor: AllowedActor,
  dependencies: ProgramBuildDependencies,
): Promise<ProgramBuildAcceptanceV1> {
  const input = AcceptProgramBuildInputV1Schema.parse(rawInput)
  const { stored, compilationProfile, catalogSelection, draft } = await loadAuthorizedBuild(
    buildId,
    actor,
    dependencies,
  )
  const normalized = {
    loadChoices: [...input.loadChoices].sort((left, right) => left.exerciseInstanceId.localeCompare(right.exerciseInstanceId)),
    conditioningChoices: [...input.conditioningChoices].sort((left, right) => left.boutId.localeCompare(right.boutId)),
  }
  const selectionHash = stableHash(normalized)
  const existing = await dependencies.loadDraftByBuild(stored.id)
  if (existing) {
    if (existing.selectionHash !== selectionHash) throw new ProgramBuildError('program_build_selection_conflict')
    TrainingProgramRevisionV1Schema.parse(existing.program)
    return { schemaVersion: 'training-build-acceptance.v1', buildId: stored.id, draftId: existing.id }
  }

  const now = dependencies.now()
  const draftId = (dependencies.newId ?? randomUUID)()
  const program = assembleProgram(
    stored,
    draft,
    compilationProfile,
    catalogSelection.catalog,
    actor,
    normalized,
    now,
    draftId,
    selectionHash,
  )
  let insertion: 'inserted' | 'source_build_conflict'
  try {
    insertion = await dependencies.insertDraft({
      id: draftId, subjectId: stored.subjectId, createdByUserId: actor.userId,
      profileRevision: stored.profileRevision, simulationRunId: stored.simulationRunId,
      eligibilitySourceRevisionId: stored.eligibilitySourceRevisionId,
      sourceBuildId: stored.id, selectionHash, program,
      createdAt: now.toISOString(), expiresAt: stored.expiresAt,
    })
  } catch {
    throw new ProgramBuildError('program_build_persistence_unavailable')
  }
  if (insertion === 'source_build_conflict') {
    const raced = await dependencies.loadDraftByBuild(stored.id)
    if (!raced || raced.selectionHash !== selectionHash) throw new ProgramBuildError('program_build_selection_conflict')
    TrainingProgramRevisionV1Schema.parse(raced.program)
    return { schemaVersion: 'training-build-acceptance.v1', buildId: stored.id, draftId: raced.id }
  }
  return { schemaVersion: 'training-build-acceptance.v1', buildId: stored.id, draftId }
}

const profileProjectionSchema = z.object({
  status: z.literal('ok'),
  subjectId: uuidSchema,
  permissions: z.array(z.string().max(128)).max(100),
  current: z.object({
    revision: positiveRevisionSchema,
    profileHash: z.string().regex(/^[a-f0-9]{64}$/),
    hashEncoding: z.literal('postgres-jsonb-text-utf8.v1'),
    profile: AthleteTrainingProfileV1Schema,
  }).strict().nullable(),
}).passthrough()

const simulationRunRowSchema = z.object({
  simulationRunId: uuidSchema,
  subjectId: uuidSchema,
  createdByUserId: uuidSchema,
  fixtureId: z.string().max(128),
  fixtureHash: z.string().regex(/^[a-f0-9]{64}$/),
  status: z.enum(['active', 'ended']),
  createdAt: z.string().datetime({ offset: true }),
  expiresAt: z.string().datetime({ offset: true }),
}).strict()

const liveSourceRowSchema = z.object({
  kind: z.literal('live'),
  subjectId: uuidSchema,
  profileRevision: positiveRevisionSchema,
  eligibilitySourceRevisionId: z.string().trim().min(1).max(160),
  policyVersion: z.string().trim().min(1).max(128),
  effectiveFrom: z.string().datetime({ offset: true }),
  effectiveUntil: z.string().datetime({ offset: true }).nullable(),
}).strict()

const buildRowSchema = z.object({
  id: uuidSchema,
  subject_id: uuidSchema,
  created_by_user_id: uuidSchema,
  profile_revision: positiveRevisionSchema,
  simulation_run_id: uuidSchema.nullable(),
  eligibility_source_revision_id: z.string().trim().min(1).max(160).nullable(),
  program_revision_id: z.string().min(1).max(128),
  compiler_policy_version: z.string().min(1).max(128),
  catalog_version: z.string().min(1).max(128),
  build_json: z.unknown(),
  created_at: z.string().datetime({ offset: true }),
  expires_at: z.string().datetime({ offset: true }),
}).strict()

const draftRowSchema = z.object({
  id: uuidSchema,
  source_build_id: uuidSchema,
  selection_hash: z.string().regex(/^[a-f0-9]{64}$/),
  program_json: z.unknown(),
}).strict()

export function createSupabaseProgramBuildDependencies(
  authenticated: SupabaseClient,
  service: SupabaseClient,
  liveCatalogRegistry: ProgramLiveCatalogRegistryV1 = EMPTY_PROGRAM_LIVE_CATALOG_REGISTRY,
): ProgramBuildDependencies {
  return {
    now: () => new Date(),
    loadCurrentProfile: async (subjectId) => {
      const { data, error } = await authenticated.rpc('resolve_training_profile_projection', {
        p_subject_id: subjectId, p_client_id: null,
      })
      if (error) throw new ProgramBuildError('program_build_unavailable')
      const parsed = profileProjectionSchema.safeParse(data)
      if (!parsed.success || parsed.data.subjectId !== subjectId || !parsed.data.current) return null
      return {
        subjectId, permissions: parsed.data.permissions,
        revision: parsed.data.current.revision, profile: parsed.data.current.profile,
      }
    },
    resolveSimulationRun: async (subjectId, profileRevision) => {
      const { data, error } = await authenticated.rpc('resolve_training_program_build_source', {
        p_subject_id: subjectId, p_profile_revision: profileRevision,
      })
      if (isTrainingConflictCode(error?.code)) throw new ProgramBuildError('program_build_stale')
      if (error) throw new ProgramBuildError('program_build_unavailable')
      const parsed = simulationRunRowSchema.safeParse(data)
      if (!parsed.success) return null
      return {
        id: parsed.data.simulationRunId, subjectId: parsed.data.subjectId,
        createdByUserId: parsed.data.createdByUserId, fixtureId: parsed.data.fixtureId,
        fixtureHash: parsed.data.fixtureHash, status: parsed.data.status,
        createdAt: parsed.data.createdAt, expiresAt: parsed.data.expiresAt,
      }
    },
    resolveLiveSource: async (
      subjectId,
      profileRevision,
      expectedEligibilitySourceRevisionId,
    ) => {
      const { data, error } = await authenticated.rpc(
        'resolve_training_live_program_build_source',
        {
          p_subject_id: subjectId,
          p_profile_revision: profileRevision,
          p_expected_eligibility_source_revision_id: expectedEligibilitySourceRevisionId,
        },
      )
      if (isTrainingConflictCode(error?.code)) {
        throw new ProgramBuildError('program_build_stale')
      }
      if (error) throw new ProgramBuildError('program_build_unavailable')
      const parsed = liveSourceRowSchema.safeParse(data)
      return parsed.success ? parsed.data : null
    },
    resolveLiveCatalog: catalogVersion => liveCatalogRegistry.resolve(catalogVersion),
    insertBuild: async (build) => {
      const { error } = await service.from('training_program_builds').insert({
        id: build.id, subject_id: build.subjectId, created_by_user_id: build.createdByUserId,
        profile_revision: build.profileRevision, simulation_run_id: build.simulationRunId,
        eligibility_source_revision_id: build.eligibilitySourceRevisionId,
        program_revision_id: build.programRevisionId,
        compiler_policy_version: build.compilerPolicyVersion, catalog_version: build.catalogVersion,
        build_json: build.build, created_at: build.createdAt, expires_at: build.expiresAt,
      })
      if (error) throw error
    },
    loadBuild: async (buildId) => {
      const { data, error } = await authenticated.from('training_program_builds')
        .select('id,subject_id,created_by_user_id,profile_revision,simulation_run_id,eligibility_source_revision_id,program_revision_id,compiler_policy_version,catalog_version,build_json,created_at,expires_at')
        .eq('id', buildId).maybeSingle()
      if (error) throw new ProgramBuildError('program_build_unavailable')
      const parsed = buildRowSchema.safeParse(data)
      if (!parsed.success) return null
      return {
        id: parsed.data.id, subjectId: parsed.data.subject_id,
        createdByUserId: parsed.data.created_by_user_id, profileRevision: parsed.data.profile_revision,
        simulationRunId: parsed.data.simulation_run_id,
        eligibilitySourceRevisionId: parsed.data.eligibility_source_revision_id,
        programRevisionId: parsed.data.program_revision_id,
        compilerPolicyVersion: parsed.data.compiler_policy_version, catalogVersion: parsed.data.catalog_version,
        build: parsed.data.build_json, createdAt: parsed.data.created_at, expiresAt: parsed.data.expires_at,
      }
    },
    loadDraftByBuild: async (buildId) => {
      const { data, error } = await authenticated.from('training_program_drafts')
        .select('id,source_build_id,selection_hash,program_json')
        .eq('source_build_id', buildId).maybeSingle()
      if (error) throw new ProgramBuildError('program_build_unavailable')
      const parsed = draftRowSchema.safeParse(data)
      if (!parsed.success) return null
      return {
        id: parsed.data.id, sourceBuildId: parsed.data.source_build_id,
        selectionHash: parsed.data.selection_hash, program: parsed.data.program_json,
      }
    },
    insertDraft: async (draft) => {
      const { error } = await service.from('training_program_drafts').insert({
        id: draft.id, subject_id: draft.subjectId, created_by_user_id: draft.createdByUserId,
        profile_revision: draft.profileRevision, simulation_run_id: draft.simulationRunId,
        eligibility_source_revision_id: draft.eligibilitySourceRevisionId,
        source_build_id: draft.sourceBuildId, selection_hash: draft.selectionHash,
        program_json: draft.program, created_at: draft.createdAt, expires_at: draft.expiresAt,
      })
      if (!error) return 'inserted'
      if (error.code === '23505') return 'source_build_conflict'
      throw error
    },
  }
}
