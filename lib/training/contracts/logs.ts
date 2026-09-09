import { z } from 'zod'
import {
  EquipmentLoadBasisV1Schema,
  ExactLoadQuantityV1Schema,
  ExecutionContextV1Schema,
  TrainingStableIdV1Schema,
} from './program'

export const TRAINING_SET_LOG_EVENT_SCHEMA_VERSION = 'training-set-log-event.v1' as const

export const TrainingSetLogEventV1Schema = z.object({
  schemaVersion: z.literal(TRAINING_SET_LOG_EVENT_SCHEMA_VERSION),
  eventId: TrainingStableIdV1Schema,
  eventType: z.enum(['set_actual_recorded', 'set_actual_corrected']),
  eventRevision: z.number().int().min(1),
  replacesEventId: TrainingStableIdV1Schema.nullable(),
  subjectId: TrainingStableIdV1Schema,
  sessionId: TrainingStableIdV1Schema,
  exerciseInstanceId: TrainingStableIdV1Schema,
  setId: TrainingStableIdV1Schema,
  setKind: z.enum(['warmup', 'working', 'extra']),
  workingSetOrdinal: z.number().int().min(1).max(100).nullable(),
  executionContext: ExecutionContextV1Schema,
  equipmentId: TrainingStableIdV1Schema,
  loadBasis: EquipmentLoadBasisV1Schema,
  quantity: ExactLoadQuantityV1Schema,
  reps: z.number().int().min(0).max(100),
  rir: z.union([z.number().int().min(0).max(5), z.literal('6_plus'), z.literal('unknown')]),
  side: z.enum(['bilateral', 'left', 'right', 'not_applicable']),
  symptomState: z.enum(['none', 'adverse_reported']),
  actor: z.object({ kind: z.enum(['athlete', 'coach']), userId: TrainingStableIdV1Schema }).strict(),
  occurredAt: z.string().datetime({ offset: true }),
  serverAt: z.string().datetime({ offset: true }),
}).strict().superRefine((event, ctx) => {
  if ((event.eventType === 'set_actual_corrected') !== (event.replacesEventId !== null)) {
    ctx.addIssue({ code: 'custom', message: 'Corrections require the replaced event ID', path: ['replacesEventId'] })
  }
  if ((event.setKind === 'working') !== (event.workingSetOrdinal !== null)) {
    ctx.addIssue({ code: 'custom', message: 'Only working sets carry a working-set ordinal', path: ['workingSetOrdinal'] })
  }
})

export type TrainingSetLogEventV1 = z.infer<typeof TrainingSetLogEventV1Schema>


export const TrainingConditioningActualInputV1Schema = z.object({
  durationSeconds: z.number().int().min(0).max(86_400),
  perceivedEffort: z.union([z.number().int().min(0).max(10), z.literal('unknown')]),
  symptomState: z.enum(['none', 'adverse_reported']),
  occurredAt: z.string().datetime({ offset: true }),
}).strict()

export const TrainingConditioningLogEventV1Schema = TrainingConditioningActualInputV1Schema.extend({
  schemaVersion: z.literal('training-conditioning-log-event.v1'),
  eventId: TrainingStableIdV1Schema,
  eventType: z.enum(['conditioning_actual_recorded', 'conditioning_actual_corrected']),
  eventRevision: z.number().int().min(1),
  replacesEventId: TrainingStableIdV1Schema.nullable(),
  subjectId: TrainingStableIdV1Schema,
  sessionId: TrainingStableIdV1Schema,
  boutId: TrainingStableIdV1Schema,
  modalityId: TrainingStableIdV1Schema,
  executionContext: ExecutionContextV1Schema,
  actor: z.object({ kind: z.enum(['athlete', 'coach']), userId: TrainingStableIdV1Schema }).strict(),
  serverAt: z.string().datetime({ offset: true }),
}).strict().superRefine((event, ctx) => {
  if ((event.eventType === 'conditioning_actual_corrected') !== (event.replacesEventId !== null)) {
    ctx.addIssue({ code: 'custom', message: 'Corrections require the replaced event ID', path: ['replacesEventId'] })
  }
})
export type TrainingConditioningLogEventV1 = z.infer<typeof TrainingConditioningLogEventV1Schema>
