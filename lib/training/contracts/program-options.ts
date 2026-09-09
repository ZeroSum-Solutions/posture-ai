import { z } from 'zod'
import { TrainingCatalogOriginV1Schema } from '../catalog/types'
import {
  EquipmentLoadBasisV1Schema,
  ExecutionContextV1Schema,
  TrainingStableIdV1Schema,
  catalogOriginMatchesExecutionContext,
} from './program'
import { ConditioningPreferenceV1Schema } from './profile'

export const TRAINING_PROGRAM_OPTIONS_SCHEMA_VERSION = 'training-program-options.v1' as const

const conditioningModeOptionSchema = z.object({
  modalityId: TrainingStableIdV1Schema,
  label: z.string().trim().min(1).max(160),
}).strict()

const equipmentOptionSchema = z.object({
  equipmentId: TrainingStableIdV1Schema,
  basis: EquipmentLoadBasisV1Schema,
  unit: z.enum(['kg', 'lb']),
}).strict()

const exerciseOptionSchema = z.object({
  exerciseVersionId: TrainingStableIdV1Schema,
  label: z.string().trim().min(1).max(160),
  equipmentOptions: z.array(equipmentOptionSchema).min(1).max(1000),
}).strict().superRefine((exercise, ctx) => {
  const tuples = exercise.equipmentOptions.map(option => (
    `${option.equipmentId}\u0000${option.basis}\u0000${option.unit}`
  ))
  if (new Set(tuples).size !== tuples.length) {
    ctx.addIssue({ code: 'custom', message: 'Exercise equipment option tuples must be unique', path: ['equipmentOptions'] })
  }
})

const preferenceProjectionSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('required') }).strict(),
  z.object({ status: z.literal('ready'), value: ConditioningPreferenceV1Schema }).strict(),
  z.object({ status: z.literal('stale_catalog'), value: ConditioningPreferenceV1Schema }).strict(),
  z.object({
    status: z.literal('unavailable_modality'),
    value: ConditioningPreferenceV1Schema,
    unavailableModalityIds: z.array(TrainingStableIdV1Schema).min(1).max(8),
  }).strict(),
])

export const TrainingProgramOptionsV1Schema = z.object({
  schemaVersion: z.literal(TRAINING_PROGRAM_OPTIONS_SCHEMA_VERSION),
  subjectId: z.string().uuid(),
  profileRevision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  executionContext: ExecutionContextV1Schema,
  catalogVersion: TrainingStableIdV1Schema,
  catalogOrigin: TrainingCatalogOriginV1Schema,
  conditioningPreference: preferenceProjectionSchema,
  conditioningModes: z.array(conditioningModeOptionSchema).max(50),
  exerciseOptions: z.array(exerciseOptionSchema).max(200),
}).strict().superRefine((projection, ctx) => {
  if (!catalogOriginMatchesExecutionContext(projection.catalogOrigin, projection.executionContext)) {
    ctx.addIssue({ code: 'custom', message: 'Catalog origin must match execution context', path: ['catalogOrigin'] })
  }
  const modalityIds = projection.conditioningModes.map(mode => mode.modalityId)
  if (new Set(modalityIds).size !== modalityIds.length) {
    ctx.addIssue({ code: 'custom', message: 'Conditioning option IDs must be unique', path: ['conditioningModes'] })
  }
  const preference = projection.conditioningPreference
  if (preference.status === 'ready'
    && (preference.value.catalogVersion !== projection.catalogVersion
      || preference.value.preferredModalityIds.some(id => !modalityIds.includes(id)))) {
    ctx.addIssue({ code: 'custom', message: 'Ready preference must match selectable options in this catalog', path: ['conditioningPreference'] })
  }
  if (preference.status === 'stale_catalog'
    && preference.value.catalogVersion === projection.catalogVersion) {
    ctx.addIssue({ code: 'custom', message: 'Stale preference must name another catalog version', path: ['conditioningPreference'] })
  }
  if (preference.status === 'unavailable_modality') {
    const unavailable = preference.value.preferredModalityIds.filter(id => !modalityIds.includes(id))
    if (preference.value.catalogVersion !== projection.catalogVersion
      || unavailable.length !== preference.unavailableModalityIds.length
      || unavailable.some((id, index) => id !== preference.unavailableModalityIds[index])) {
      ctx.addIssue({ code: 'custom', message: 'Unavailable preference must identify exact missing options', path: ['conditioningPreference'] })
    }
  }
  const exerciseIds = projection.exerciseOptions.map(exercise => exercise.exerciseVersionId)
  if (new Set(exerciseIds).size !== exerciseIds.length) {
    ctx.addIssue({ code: 'custom', message: 'Exercise option IDs must be unique', path: ['exerciseOptions'] })
  }
})

export type TrainingProgramOptionsV1 = z.infer<typeof TrainingProgramOptionsV1Schema>
export type TrainingProgramConditioningPreferenceV1 = z.infer<typeof preferenceProjectionSchema>
