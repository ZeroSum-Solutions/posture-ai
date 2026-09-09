import { z } from 'zod'
import {
  ActiveCalibrationLoadV1Schema,
  ActiveCalibrationOfferV1Schema,
  ActiveCalibrationSeriesIntentV1Schema,
} from './active-calibration'
import { ExecutionContextV1Schema, TrainingStableIdV1Schema } from './program'

export const ACTIVE_CALIBRATION_PROJECTION_SCHEMA_VERSION = 'active-calibration-projection.v1' as const
export const ACTIVE_CALIBRATION_ACCEPTANCE_SCHEMA_VERSION = 'active-calibration-acceptance.v1' as const

export const CreateActiveCalibrationProposalInputV1Schema = z.object({
  sessionId: TrainingStableIdV1Schema,
  exerciseInstanceId: TrainingStableIdV1Schema,
}).strict()

export const ActiveCalibrationProposalProjectionV1Schema = z.object({
  schemaVersion: z.literal(ACTIVE_CALIBRATION_PROJECTION_SCHEMA_VERSION),
  proposalId: z.string().uuid().nullable(),
  offer: ActiveCalibrationOfferV1Schema,
}).strict().superRefine((projection, ctx) => {
  if ((projection.offer.kind === 'options') !== (projection.proposalId !== null)) {
    ctx.addIssue({
      code: 'custom',
      message: 'Only a selectable active calibration offer may have a proposal ID',
      path: ['proposalId'],
    })
  }
})

export const AcceptActiveCalibrationProposalInputV1Schema = z.object({
  requestId: z.string().uuid(),
  optionIndex: z.number().int().min(0).max(49_999),
}).strict()

export const ActiveCalibrationAcceptanceV1Schema = z.object({
  schemaVersion: z.literal(ACTIVE_CALIBRATION_ACCEPTANCE_SCHEMA_VERSION),
  proposalId: z.string().uuid(),
  assignmentId: TrainingStableIdV1Schema,
  programRevisionNumber: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  executionContext: ExecutionContextV1Schema,
  selectedLoad: ActiveCalibrationLoadV1Schema,
  seriesIntent: ActiveCalibrationSeriesIntentV1Schema,
  newProgressionSeriesId: TrainingStableIdV1Schema,
  affectedTargets: z.array(z.object({
    sessionId: TrainingStableIdV1Schema,
    exerciseInstanceId: TrainingStableIdV1Schema,
  }).strict()).min(1).max(64),
}).strict().superRefine((acceptance, ctx) => {
  if (acceptance.newProgressionSeriesId === acceptance.seriesIntent.sourceProgressionSeriesId) {
    ctx.addIssue({
      code: 'custom',
      message: 'Accepted familiarization must start a new progression series',
      path: ['newProgressionSeriesId'],
    })
  }
})

export type CreateActiveCalibrationProposalInputV1 = z.infer<typeof CreateActiveCalibrationProposalInputV1Schema>
export type ActiveCalibrationProposalProjectionV1 = z.infer<typeof ActiveCalibrationProposalProjectionV1Schema>
export type ActiveCalibrationAcceptanceV1 = z.infer<typeof ActiveCalibrationAcceptanceV1Schema>
