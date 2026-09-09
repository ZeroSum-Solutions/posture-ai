import { z } from 'zod'
import { BodyweightAssistancePolicyReferenceV1Schema } from '../catalog/types'
import {
  EquipmentLoadBasisV1Schema,
  ExactLoadQuantityV1Schema,
  ExecutionContextV1Schema,
  TrainingStableIdV1Schema,
} from './program'

export const TRAINING_PREVIOUS_PERFORMANCE_SCHEMA_VERSION = 'training-previous-performance.v1' as const

const utcTimestampSchema = z.string().datetime({ offset: true }).refine(value => value.endsWith('Z'))
const localDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const rirSchema = z.union([
  z.number().int().min(0).max(5),
  z.literal('6_plus'),
  z.literal('unknown'),
])

const sourceSchema = z.object({
  sessionId: TrainingStableIdV1Schema,
  exerciseInstanceId: TrainingStableIdV1Schema,
  sessionRevision: z.number().int().positive(),
  sourceRevisionId: TrainingStableIdV1Schema,
  prescriptionSourceRevisionId: TrainingStableIdV1Schema,
  progressionSeriesId: TrainingStableIdV1Schema,
  bodyweightAssistancePolicy: BodyweightAssistancePolicyReferenceV1Schema.optional(),
  scheduledLocalDate: localDateSchema,
  completedAt: utcTimestampSchema,
  executionContext: ExecutionContextV1Schema,
  effectiveEvents: z.array(z.object({
    eventId: TrainingStableIdV1Schema,
    eventRevision: z.number().int().positive(),
  }).strict()).min(1).max(100),
}).strict()

const performedSetSchema = z.object({
  ordinal: z.number().int().positive().max(100),
  load: z.object({
    equipmentId: TrainingStableIdV1Schema,
    basis: EquipmentLoadBasisV1Schema,
    quantity: ExactLoadQuantityV1Schema,
  }).strict(),
  reps: z.number().int().min(1).max(100),
  rir: rirSchema,
  side: z.enum(['bilateral', 'left', 'right', 'not_applicable']),
}).strict()

const availableSchema = z.object({
  kind: z.literal('available'),
  source: sourceSchema,
  sets: z.array(performedSetSchema).min(1).max(100),
}).strict().superRefine((result, context) => {
  const first = result.sets[0]
  const usesDedicatedPolicy = first.load.basis === 'bodyweight_external'
    || first.load.basis === 'machine_assistance'
  if (usesDedicatedPolicy !== (result.source.bodyweightAssistancePolicy !== undefined)) {
    context.addIssue({
      code: 'custom', path: ['source', 'bodyweightAssistancePolicy'],
      message: 'Bodyweight and assistance history requires exact policy identity',
    })
  }
  result.sets.forEach((set, index) => {
    if (set.ordinal !== index + 1) {
      context.addIssue({ code: 'custom', path: ['sets', index, 'ordinal'], message: 'Working sets must be ordered' })
    }
    if (set.load.equipmentId !== first.load.equipmentId
      || set.load.basis !== first.load.basis
      || set.side !== first.side) {
      context.addIssue({ code: 'custom', path: ['sets', index], message: 'Working-set comparator identity must match' })
    }
  })
  if (result.source.effectiveEvents.length !== result.sets.length) {
    context.addIssue({ code: 'custom', path: ['source', 'effectiveEvents'], message: 'Each performed set requires one effective event' })
  }
})

const resultSchema = z.discriminatedUnion('kind', [
  availableSchema,
  z.object({
    kind: z.literal('none'),
    reason: z.literal('no_comparable_completed_exposure'),
  }).strict(),
  z.object({
    kind: z.literal('unavailable'),
    reason: z.enum([
      'current_comparator_unavailable',
      'historical_evidence_unavailable',
      'persistence_unavailable',
    ]),
  }).strict(),
])

export const TrainingPreviousPerformanceV1Schema = z.object({
  schemaVersion: z.literal(TRAINING_PREVIOUS_PERFORMANCE_SCHEMA_VERSION),
  request: z.object({
    sessionId: TrainingStableIdV1Schema,
    exerciseInstanceId: TrainingStableIdV1Schema,
  }).strict(),
  result: resultSchema,
}).strict()

export type TrainingPreviousPerformanceV1 = z.infer<typeof TrainingPreviousPerformanceV1Schema>
export type AvailablePreviousPerformanceV1 = z.infer<typeof availableSchema>
