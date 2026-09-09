import { z } from 'zod'
import {
  ManualRecalibrationOfferV1Schema,
  ManualRecalibrationSeriesIntentV1Schema,
  ManualRecalibrationSourceDecisionV1Schema,
} from './manual-recalibration'
import { ActiveCalibrationLoadV1Schema } from './active-calibration'
import { ExecutionContextV1Schema, TrainingStableIdV1Schema } from './program'

export const MANUAL_RECALIBRATION_PROJECTION_SCHEMA_VERSION = 'manual-recalibration-projection.v1' as const
export const MANUAL_RECALIBRATION_ACCEPTANCE_SCHEMA_VERSION = 'manual-recalibration-acceptance.v1' as const

export const CreateManualRecalibrationProposalInputV1Schema = z.object({
  sessionId: TrainingStableIdV1Schema,
  exerciseInstanceId: TrainingStableIdV1Schema,
}).strict()

export const ManualRecalibrationProposalProjectionV1Schema = z.object({
  schemaVersion: z.literal(MANUAL_RECALIBRATION_PROJECTION_SCHEMA_VERSION),
  proposalId: z.string().uuid().nullable(),
  offer: ManualRecalibrationOfferV1Schema,
}).strict().superRefine((projection, ctx) => {
  if ((projection.offer.kind === 'options') !== (projection.proposalId !== null)) {
    ctx.addIssue({
      code: 'custom',
      message: 'Only a selectable manual recalibration offer may have a proposal ID',
      path: ['proposalId'],
    })
  }
})

export const AcceptManualRecalibrationProposalInputV1Schema = z.object({
  requestId: z.string().uuid(),
  optionIndex: z.number().int().min(0).max(49_999),
  outlierAcknowledged: z.boolean(),
}).strict()

export const ManualRecalibrationAcceptanceV1Schema = z.object({
  schemaVersion: z.literal(MANUAL_RECALIBRATION_ACCEPTANCE_SCHEMA_VERSION),
  proposalId: z.string().uuid(),
  assignmentId: TrainingStableIdV1Schema,
  programRevisionNumber: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  executionContext: ExecutionContextV1Schema,
  selectedLoad: ActiveCalibrationLoadV1Schema,
  sourceDecision: ManualRecalibrationSourceDecisionV1Schema,
  outlierAcknowledged: z.boolean(),
  seriesIntent: ManualRecalibrationSeriesIntentV1Schema,
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

export type CreateManualRecalibrationProposalInputV1 = z.infer<typeof CreateManualRecalibrationProposalInputV1Schema>
export type ManualRecalibrationProposalProjectionV1 = z.infer<typeof ManualRecalibrationProposalProjectionV1Schema>
export type ManualRecalibrationAcceptanceV1 = z.infer<typeof ManualRecalibrationAcceptanceV1Schema>
