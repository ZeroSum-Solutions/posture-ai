import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { resolveSyntheticTrainingCatalogByFixture } from '../catalog/syntheticRegistry'
import { TrainingCatalogV1Schema, type ConditioningModeV1, type TrainingCatalogV1, type TrainingExerciseV1 } from '../catalog/types'
import type { ConditioningPreferenceV1 } from '../contracts/profile'
import {
  TRAINING_PROGRAM_OPTIONS_SCHEMA_VERSION,
  TrainingProgramOptionsV1Schema,
  type TrainingProgramConditioningPreferenceV1,
  type TrainingProgramOptionsV1,
} from '../contracts/program-options'
import { enumerateEquipmentLoadsWithinBounds, type EquipmentInventory } from '../equipment'
import type { TrainingServerActor } from '../access/server-actor'
import {
  EMPTY_PROGRAM_LIVE_CATALOG_REGISTRY,
  createSupabaseProgramBuildDependencies,
  type ProgramCatalogSelectionV1,
  type ProgramLiveCatalogRegistryV1,
  type ProgramProfileProjectionV1,
  type ProgramSimulationRunV1,
} from './program-build'

export const ReadProgramOptionsInputV1Schema = z.object({
  subjectId: z.string().uuid(),
  profileRevision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
}).strict()

export type ReadProgramOptionsInputV1 = z.infer<typeof ReadProgramOptionsInputV1Schema>
type AllowedActor = Extract<TrainingServerActor, { ok: true }>

export interface ProgramOptionsDependencies {
  readonly now: () => Date
  readonly loadCurrentProfile: (subjectId: string) => Promise<ProgramProfileProjectionV1 | null>
  readonly resolveSimulationRun: (subjectId: string, profileRevision: number) => Promise<ProgramSimulationRunV1 | null>
  readonly resolveLiveCatalog: (catalogVersion?: string) => ProgramCatalogSelectionV1 | null
}

export type ProgramOptionsErrorCode =
  | 'program_options_unavailable'
  | 'program_options_forbidden'
  | 'program_options_stale'

export class ProgramOptionsError extends Error {
  constructor(readonly code: ProgramOptionsErrorCode) {
    super(code)
    this.name = 'ProgramOptionsError'
  }
}

function requireAllowedActor(actor: AllowedActor, profile: ProgramProfileProjectionV1): void {
  if (actor.actorKind === 'athlete' && actor.subjectId === profile.subjectId) return
  if (actor.actorKind === 'practitioner' && profile.permissions.includes('profile:read')) return
  throw new ProgramOptionsError('program_options_forbidden')
}

function contentIsVisible(exercise: TrainingExerciseV1, catalog: TrainingCatalogV1): boolean {
  if (exercise.lifecycle !== 'active') return false
  if (catalog.origin.kind === 'synthetic_fixture') {
    return exercise.contentReviewStatus === 'reviewed_fixture'
      && (exercise.mediaStatus === 'reviewed_static_fixture'
        || (exercise.mediaStatus === 'missing' && typeof exercise.textInstruction === 'string'))
  }
  return exercise.contentReviewStatus === 'reviewed' && exercise.mediaStatus === 'reviewed_exact_variant'
}

function conditioningIsVisible(mode: ConditioningModeV1, catalog: TrainingCatalogV1): boolean {
  if (mode.lifecycle !== 'active') return false
  return catalog.origin.kind === 'synthetic_fixture'
    ? mode.contentReviewStatus === 'reviewed_fixture'
    : mode.contentReviewStatus === 'reviewed'
}

function equipmentOptions(exercise: TrainingExerciseV1, inventory: readonly EquipmentInventory[]) {
  const options = exercise.equipmentCompatibility.flatMap(compatibility => (
    inventory.flatMap(equipment => {
      if (compatibility.kind !== equipment.kind) return []
      try {
        if (enumerateEquipmentLoadsWithinBounds(equipment, compatibility.basis, compatibility).length === 0) return []
      } catch {
        return []
      }
      return [{ equipmentId: equipment.equipmentId, basis: compatibility.basis, unit: equipment.unit }]
    })
  ))
  return [...new Map(options.map(option => [
    `${option.equipmentId}\u0000${option.basis}\u0000${option.unit}`, option,
  ])).values()].sort((left, right) => (
    left.equipmentId.localeCompare(right.equipmentId)
      || left.basis.localeCompare(right.basis)
      || left.unit.localeCompare(right.unit)
  ))
}

function projectPreference(
  preference: ConditioningPreferenceV1 | undefined,
  catalog: TrainingCatalogV1,
  visibleModalityIds: ReadonlySet<string>,
): TrainingProgramConditioningPreferenceV1 {
  if (!preference) return { status: 'required' }
  if (preference.catalogVersion !== catalog.catalogVersion) {
    return { status: 'stale_catalog', value: preference }
  }
  const unavailableModalityIds = preference.preferredModalityIds.filter(id => !visibleModalityIds.has(id))
  if (unavailableModalityIds.length > 0) {
    return { status: 'unavailable_modality', value: preference, unavailableModalityIds }
  }
  return { status: 'ready', value: preference }
}

function projectOptions(
  profile: ProgramProfileProjectionV1,
  catalogSelection: ProgramCatalogSelectionV1,
  executionContext: TrainingProgramOptionsV1['executionContext'],
): TrainingProgramOptionsV1 {
  const catalog = TrainingCatalogV1Schema.parse(catalogSelection.catalog)
  const conditioningModes = catalog.conditioningModes
    .filter(mode => conditioningIsVisible(mode, catalog))
    .sort((left, right) => left.preferenceRank - right.preferenceRank || left.modalityId.localeCompare(right.modalityId))
    .map(({ modalityId, label }) => ({ modalityId, label }))
  const visibleModalityIds = new Set(conditioningModes.map(mode => mode.modalityId))
  const exerciseOptions = catalog.exercises
    .filter(exercise => contentIsVisible(exercise, catalog))
    .sort((left, right) => left.preferenceRank - right.preferenceRank
      || left.exerciseVersionId.localeCompare(right.exerciseVersionId))
    .map(exercise => ({
      exerciseVersionId: exercise.exerciseVersionId,
      label: exercise.label,
      equipmentOptions: equipmentOptions(exercise, profile.profile.equipmentInventory),
    }))
    .filter(exercise => exercise.equipmentOptions.length > 0)
  return TrainingProgramOptionsV1Schema.parse({
    schemaVersion: TRAINING_PROGRAM_OPTIONS_SCHEMA_VERSION,
    subjectId: profile.subjectId,
    profileRevision: profile.revision,
    executionContext,
    catalogVersion: catalog.catalogVersion,
    catalogOrigin: catalog.origin,
    conditioningPreference: projectPreference(
      profile.profile.conditioningPreference,
      catalog,
      visibleModalityIds,
    ),
    conditioningModes,
    exerciseOptions,
  })
}

export async function readTrainingProgramOptions(
  rawInput: unknown,
  actor: AllowedActor,
  dependencies: ProgramOptionsDependencies,
): Promise<TrainingProgramOptionsV1> {
  const input = ReadProgramOptionsInputV1Schema.parse(rawInput)
  const profile = await dependencies.loadCurrentProfile(input.subjectId)
  if (!profile) throw new ProgramOptionsError('program_options_unavailable')
  requireAllowedActor(actor, profile)
  if (profile.revision !== input.profileRevision) throw new ProgramOptionsError('program_options_stale')

  if (profile.profile.origin.kind === 'synthetic_fixture') {
    const run = await dependencies.resolveSimulationRun(input.subjectId, input.profileRevision)
    if (!run || run.subjectId !== input.subjectId || run.status !== 'active'
      || Date.parse(run.expiresAt) <= dependencies.now().getTime()) {
      throw new ProgramOptionsError('program_options_unavailable')
    }
    if (actor.actorKind === 'practitioner' && run.createdByUserId !== actor.userId) {
      throw new ProgramOptionsError('program_options_forbidden')
    }
    const catalog = resolveSyntheticTrainingCatalogByFixture(run.fixtureId, run.fixtureHash)
    if (!catalog || catalog.origin.kind !== 'synthetic_fixture') {
      throw new ProgramOptionsError('program_options_unavailable')
    }
    return projectOptions(profile, {
      catalog,
      conditioningModalityId: catalog.conditioningModes[0]?.modalityId ?? '',
    }, {
      kind: 'synthetic_simulation', simulationRunId: run.id,
      fixtureId: catalog.origin.fixtureId, fixtureHash: catalog.origin.fixtureHash,
      label: 'Practice data',
    })
  }

  const catalogSelection = dependencies.resolveLiveCatalog()
  if (!catalogSelection || catalogSelection.catalog.origin.kind !== 'authored_catalog') {
    throw new ProgramOptionsError('program_options_unavailable')
  }
  return projectOptions(profile, catalogSelection, { kind: 'live' })
}

export function createSupabaseProgramOptionsDependencies(
  authenticated: SupabaseClient,
  liveCatalogRegistry: ProgramLiveCatalogRegistryV1 = EMPTY_PROGRAM_LIVE_CATALOG_REGISTRY,
): ProgramOptionsDependencies {
  const dependencies = createSupabaseProgramBuildDependencies(
    authenticated,
    authenticated,
    liveCatalogRegistry,
  )
  return {
    now: dependencies.now,
    loadCurrentProfile: dependencies.loadCurrentProfile,
    resolveSimulationRun: dependencies.resolveSimulationRun,
    resolveLiveCatalog: dependencies.resolveLiveCatalog,
  }
}
