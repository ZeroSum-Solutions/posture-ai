import { z } from 'zod'
import {
  AcceptedConditioningBoutV1Schema,
  ExecutionContextV1Schema,
  TrainingStableIdV1Schema,
} from './program'

export const CONDITIONING_REVISION_SCHEMA_VERSION = 'conditioning-revision.v1' as const

export const ConditioningProgressionIdentityV1Schema = z.object({
  progressionSeriesId: TrainingStableIdV1Schema,
  evidenceEpoch: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
}).strict()

function isRealLocalDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day
}

function isIanaTimezone(value: string): boolean {
  if (!value.includes('/') && value !== 'UTC') return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format()
    return true
  } catch {
    return false
  }
}

export const ConditioningLocalDateV1Schema = z.string().refine(isRealLocalDate, 'Invalid local calendar date')

export const ConditioningRevisionSelectionV1Schema = z.object({
  replacementModalityId: TrainingStableIdV1Schema,
  futureBouts: z.array(z.object({
    sourceBoutId: TrainingStableIdV1Schema,
    scheduledLocalDate: ConditioningLocalDateV1Schema,
    acceptedDurationSeconds: z.number().int().min(60).max(1_800),
    arrangement: z.enum(['separate', 'paired_strength_first']),
  }).strict()).min(1).max(24),
}).strict().superRefine((selection, ctx) => {
  const ids = selection.futureBouts.map(bout => bout.sourceBoutId)
  if (new Set(ids).size !== ids.length) {
    ctx.addIssue({ code: 'custom', message: 'Future bout IDs must be unique', path: ['futureBouts'] })
  }
})

export const ConditioningRevisionSourceV1Schema = z.object({
  schemaVersion: z.literal('conditioning-revision-source.v1'),
  assignmentId: TrainingStableIdV1Schema,
  subjectId: TrainingStableIdV1Schema,
  baseProgramRevisionNumber: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  compiledProgramRevisionId: TrainingStableIdV1Schema,
  compilerPolicyVersion: TrainingStableIdV1Schema,
  executionContext: ExecutionContextV1Schema,
  catalogVersion: TrainingStableIdV1Schema,
  athleteTimezone: z.string().trim().min(1).max(100).refine(isIanaTimezone, 'Invalid IANA timezone'),
  strengthSessions: z.array(z.object({
    sessionId: TrainingStableIdV1Schema,
    scheduledLocalDate: ConditioningLocalDateV1Schema,
  }).strict()).max(64),
  conditioningBouts: z.array(AcceptedConditioningBoutV1Schema).min(2).max(24),
}).strict().superRefine((source, ctx) => {
  const ids = [
    ...source.strengthSessions.map(session => session.sessionId),
    ...source.conditioningBouts.map(bout => bout.boutId),
  ]
  if (new Set(ids).size !== ids.length) {
    ctx.addIssue({ code: 'custom', message: 'Program session IDs must be unique', path: ['conditioningBouts'] })
  }
})

export const ConditioningRevisionSessionStateV1Schema = z.object({
  sessionId: TrainingStableIdV1Schema,
  state: z.enum(['scheduled', 'in_progress', 'completed', 'completed_with_omissions', 'aborted']),
  hasPrescription: z.boolean(),
}).strict()

export const ConditioningPairingPolicyV1Schema = z.object({
  schemaVersion: z.literal('conditioning-pairing-policy.v1'),
  modalityId: TrainingStableIdV1Schema,
  catalogVersion: TrainingStableIdV1Schema,
  pairing: z.enum(['off_day_only', 'moderate_strength_first_allowed']),
  provenance: z.discriminatedUnion('kind', [
    z.object({
      kind: z.literal('synthetic_fixture'),
      fixtureId: TrainingStableIdV1Schema,
      fixtureHash: z.string().regex(/^[a-f0-9]{64}$/),
      label: z.enum(['Practice data', 'Simulation']),
    }).strict(),
    z.object({
      kind: z.literal('reviewed_authored_policy'),
      policyRecordId: TrainingStableIdV1Schema,
      reviewRecordId: TrainingStableIdV1Schema,
      reviewedAt: z.string().datetime({ offset: true }),
    }).strict(),
  ]),
}).strict()

const replacementSchema = z.object({
  sourceBoutId: TrainingStableIdV1Schema,
  priorModalityId: TrainingStableIdV1Schema,
  priorScheduledLocalDate: ConditioningLocalDateV1Schema,
  priorAcceptanceId: TrainingStableIdV1Schema,
  modalityId: TrainingStableIdV1Schema,
  scheduledLocalDate: ConditioningLocalDateV1Schema,
  athleteTimezone: z.string().trim().min(1).max(100),
  acceptedDurationSeconds: z.number().int().min(60).max(1_800),
  effortCue: z.string().trim().min(1).max(240),
  arrangement: z.enum(['separate', 'paired_strength_first']),
  progressionIdentity: ConditioningProgressionIdentityV1Schema.optional(),
  evidenceBoundary: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('preserved') }).strict(),
    z.object({
      kind: z.literal('reset'),
      reason: z.enum(['duration_changed', 'modality_changed']),
    }).strict(),
  ]),
  pairingPolicy: ConditioningPairingPolicyV1Schema.optional(),
  comparability: z.discriminatedUnion('kind', [
    z.object({
      kind: z.literal('new_series'),
      reason: z.literal('modality_changed_recalibration'),
    }).strict(),
    z.object({
      kind: z.literal('preserved_series'),
      reason: z.literal('schedule_or_duration_revision'),
    }).strict(),
  ]),
}).strict().superRefine((replacement, ctx) => {
  if ((replacement.arrangement === 'paired_strength_first') !== Boolean(replacement.pairingPolicy)) {
    ctx.addIssue({ code: 'custom', message: 'Paired arrangement requires exact authored policy provenance', path: ['pairingPolicy'] })
  }
})

const conflictSchema = z.object({
  sourceBoutId: TrainingStableIdV1Schema,
  requestedLocalDate: ConditioningLocalDateV1Schema,
  reason: z.enum([
    'before_current_local_date',
    'outside_source_week',
    'strength_date_requires_arrangement',
    'conditioning_date_collision',
    'paired_arrangement_unavailable',
  ]),
  collidingSessionId: TrainingStableIdV1Schema.optional(),
  offDayAlternatives: z.array(ConditioningLocalDateV1Schema).max(7),
  pairedOptionAvailable: z.boolean(),
}).strict()

export const ConditioningRevisionResultV1Schema = z.object({
  schemaVersion: z.literal(CONDITIONING_REVISION_SCHEMA_VERSION),
  result: z.discriminatedUnion('kind', [
    z.object({
      kind: z.literal('revision_ready'),
      status: z.literal('requires_explicit_revision_acceptance'),
      assignmentId: TrainingStableIdV1Schema,
      subjectId: TrainingStableIdV1Schema,
      baseProgramRevisionNumber: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
      compiledProgramRevisionId: TrainingStableIdV1Schema,
      compilerPolicyVersion: TrainingStableIdV1Schema,
      catalogVersion: TrainingStableIdV1Schema,
      executionContext: ExecutionContextV1Schema,
      preservedBoutIds: z.array(TrainingStableIdV1Schema).max(24),
      replacements: z.array(replacementSchema).min(1).max(24),
      frequencyChange: z.literal('unchanged'),
      intensityChange: z.literal('not_automated'),
      strengthPriority: z.literal('strength_first_when_paired'),
    }).strict(),
    z.object({
      kind: z.literal('reschedule_required'),
      reason: z.literal('explicit_schedule_resolution_required'),
      conflicts: z.array(conflictSchema).min(1).max(24),
    }).strict(),
    z.object({
      kind: z.literal('unavailable'),
      reason: z.enum([
        'no_changeable_bouts',
        'no_effective_change',
        'current_plan_not_two_bouts_weekly',
        'session_state_unavailable',
        'selection_mismatch',
        'source_revision_mismatch',
        'catalog_context_mismatch',
        'modality_unavailable',
        'mixed_timezone',
        'new_modality_duration_requires_1_to_20_minutes',
      ]),
    }).strict(),
  ]),
}).strict()

export const CreateConditioningRevisionProposalInputV1Schema = z.object({
  assignmentId: TrainingStableIdV1Schema,
  selection: ConditioningRevisionSelectionV1Schema,
}).strict()

export const AcceptConditioningRevisionProposalInputV1Schema = z.object({
  requestId: z.string().uuid(),
}).strict()

export const ConditioningRevisionProposalProjectionV1Schema = z.object({
  schemaVersion: z.literal('conditioning-revision-projection.v1'),
  proposalId: z.string().uuid().nullable(),
  revision: ConditioningRevisionResultV1Schema,
}).strict().superRefine((projection, ctx) => {
  const ready = projection.revision.result.kind === 'revision_ready'
  if (ready !== (projection.proposalId !== null)) {
    ctx.addIssue({ code: 'custom', message: 'Only ready revisions can bind a proposal', path: ['proposalId'] })
  }
})

export const ConditioningRevisionAcceptanceV1Schema = z.object({
  schemaVersion: z.literal('conditioning-revision-acceptance.v1'),
  proposalId: z.string().uuid(),
  assignmentId: TrainingStableIdV1Schema,
  programRevisionNumber: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  affectedBoutIds: z.array(TrainingStableIdV1Schema).min(1).max(24),
  evidenceBoundary: z.enum(['preserved', 'reset']),
}).strict()

export const ConditioningRevisionOptionsV1Schema = z.object({
  schemaVersion: z.literal('conditioning-revision-options.v1'),
  result: z.discriminatedUnion('kind', [
    z.object({
      kind: z.literal('options'),
      assignmentId: TrainingStableIdV1Schema,
      subjectId: TrainingStableIdV1Schema,
      executionContext: ExecutionContextV1Schema,
      currentLocalDate: ConditioningLocalDateV1Schema,
      athleteTimezone: z.string().trim().min(1).max(100),
      changeableBouts: z.array(z.object({
        boutId: TrainingStableIdV1Schema,
        modalityId: TrainingStableIdV1Schema,
        scheduledLocalDate: ConditioningLocalDateV1Schema,
        acceptedDurationSeconds: z.number().int().min(60).max(1_800),
        arrangement: z.enum(['separate', 'paired_strength_first']),
        progressionIdentity: ConditioningProgressionIdentityV1Schema.optional(),
      }).strict()).min(1).max(24),
      modalities: z.array(z.object({
        modalityId: TrainingStableIdV1Schema,
        label: z.string().trim().min(1).max(160),
        existingModeDurationMaximumSeconds: z.literal(1_800),
        newModeDurationMaximumSeconds: z.literal(1_200),
        strengthFirstPairingAvailable: z.boolean(),
      }).strict()).min(1).max(50),
    }).strict(),
    z.object({
      kind: z.literal('unavailable'),
      reason: z.enum(['no_changeable_bouts', 'revision_unavailable']),
    }).strict(),
  ]),
}).strict()

export type ConditioningRevisionSelectionV1 = z.infer<typeof ConditioningRevisionSelectionV1Schema>
export type ConditioningRevisionSourceV1 = z.infer<typeof ConditioningRevisionSourceV1Schema>
export type ConditioningRevisionSessionStateV1 = z.infer<typeof ConditioningRevisionSessionStateV1Schema>
export type ConditioningPairingPolicyV1 = z.infer<typeof ConditioningPairingPolicyV1Schema>
export type ConditioningRevisionResultV1 = z.infer<typeof ConditioningRevisionResultV1Schema>
export type ConditioningProgressionIdentityV1 = z.infer<typeof ConditioningProgressionIdentityV1Schema>
export type ConditioningRevisionProposalProjectionV1 = z.infer<typeof ConditioningRevisionProposalProjectionV1Schema>
export type ConditioningRevisionAcceptanceV1 = z.infer<typeof ConditioningRevisionAcceptanceV1Schema>
export type ConditioningRevisionOptionsV1 = z.infer<typeof ConditioningRevisionOptionsV1Schema>
