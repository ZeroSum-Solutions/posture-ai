import { z } from 'zod'
import type { CompilationResultV1 } from '../engine/compileProgram'
import {
  AcceptedConditioningBoutV1Schema,
  TrainingStableIdV1Schema,
  type AcceptedConditioningBoutV1,
} from './program'

type CompiledProgramDraftV1 = Extract<CompilationResultV1, { kind: 'draft_program' }>

const acceptanceInputSchema = z.object({
  boutId: TrainingStableIdV1Schema,
  acceptanceId: TrainingStableIdV1Schema,
  acceptedAt: z.string().datetime({ offset: true }),
  acceptedByUserId: TrainingStableIdV1Schema,
  acceptedDurationSeconds: z.number().int().min(60).max(1_200),
}).strict()

export interface AcceptCompiledConditioningBoutInputV1 {
  readonly draft: CompiledProgramDraftV1
  readonly boutId: string
  readonly acceptanceId: string
  readonly acceptedAt: string
  readonly acceptedByUserId: string
  readonly acceptedDurationSeconds: number
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  Object.values(value).forEach(deepFreeze)
  return Object.freeze(value)
}

export function acceptCompiledConditioningBout(
  input: AcceptCompiledConditioningBoutInputV1,
): AcceptedConditioningBoutV1 {
  const parsed = acceptanceInputSchema.parse({
    boutId: input.boutId,
    acceptanceId: input.acceptanceId,
    acceptedAt: input.acceptedAt,
    acceptedByUserId: input.acceptedByUserId,
    acceptedDurationSeconds: input.acceptedDurationSeconds,
  })
  if (input.draft.kind !== 'draft_program' || input.draft.status !== 'requires_explicit_acceptance') {
    throw new Error('Conditioning acceptance requires a compiled draft')
  }
  const matches = input.draft.weeks.flatMap(week => week.conditioningBouts)
    .filter(bout => bout.boutId === parsed.boutId)
  if (matches.length !== 1) throw new Error('Compiled conditioning bout is missing or ambiguous')
  const bout = matches[0]
  if (parsed.acceptedDurationSeconds < bout.allowedDurationSeconds.minimum
    || parsed.acceptedDurationSeconds > bout.allowedDurationSeconds.maximum) {
    throw new Error('Conditioning duration is outside the compiled offer')
  }
  return deepFreeze(AcceptedConditioningBoutV1Schema.parse({
    status: 'accepted',
    acceptanceId: parsed.acceptanceId,
    acceptedAt: parsed.acceptedAt,
    acceptedByUserId: parsed.acceptedByUserId,
    executionContext: input.draft.executionContext,
    boutId: bout.boutId,
    modalityId: bout.modalityId,
    scheduledLocalDate: bout.scheduledLocalDate,
    athleteTimezone: bout.athleteTimezone,
    acceptedDurationSeconds: parsed.acceptedDurationSeconds,
    effortCue: bout.effortCue,
    source: {
      compiledProgramRevisionId: input.draft.programRevisionId,
      compilerPolicyVersion: input.draft.compilerPolicyVersion,
      catalogVersion: input.draft.catalogVersion,
      catalogOrigin: input.draft.catalogOrigin,
    },
  }))
}
