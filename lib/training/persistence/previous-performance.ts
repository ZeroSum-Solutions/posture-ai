import { z } from 'zod'
import { TrainingSetLogEventV1Schema, type TrainingSetLogEventV1 } from '../contracts/logs'
import {
  TRAINING_PREVIOUS_PERFORMANCE_SCHEMA_VERSION,
  TrainingPreviousPerformanceV1Schema,
  type TrainingPreviousPerformanceV1,
} from '../contracts/previous-performance'
import { TrainingStableIdV1Schema, executionContextsMatch } from '../contracts/program'
import {
  adaptStrengthSessionEvidence,
  type ReadyStrengthSessionEvidenceV1,
} from '../progression/sessionEvidence'
import type { ProgressionComparatorV1 } from '../progression/types'

const sourceEnvelopeSchema = z.object({
  current: z.unknown(),
  history: z.array(z.object({
    scheduledLocalDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    evidence: z.unknown(),
  }).strict()).max(64),
}).strict()

const evidenceEventsSchema = z.object({
  currentEvents: z.array(TrainingSetLogEventV1Schema).max(600),
}).passthrough()

interface PreviousPerformanceReadClient {
  rpc(
    name: 'read_training_previous_performance_sources',
    args: { p_session_id: string; p_exercise_instance_id: string },
  ): PromiseLike<{ data: unknown; error: { code?: string } | null }>
}

export type PreviousPerformanceReadResultV1 = TrainingPreviousPerformanceV1
  | { readonly kind: 'not_found' }
  | { readonly kind: 'invalid_request' }

function response(
  sessionId: string,
  exerciseInstanceId: string,
  result: TrainingPreviousPerformanceV1['result'],
): TrainingPreviousPerformanceV1 {
  return TrainingPreviousPerformanceV1Schema.parse({
    schemaVersion: TRAINING_PREVIOUS_PERFORMANCE_SCHEMA_VERSION,
    request: { sessionId, exerciseInstanceId }, result,
  })
}

function sameRange(
  left: { readonly min: number; readonly max: number },
  right: { readonly min: number; readonly max: number },
) {
  return left.min === right.min && left.max === right.max
}

function sameBodyweightAssistancePolicy(
  left: ProgressionComparatorV1['bodyweightAssistancePolicy'],
  right: ProgressionComparatorV1['bodyweightAssistancePolicy'],
) {
  return left?.policyId === right?.policyId
    && left?.policyVersion === right?.policyVersion
}

function comparatorsMatch(
  candidate: ProgressionComparatorV1,
  target: ReadyStrengthSessionEvidenceV1,
) {
  const prescription = target.prescription
  return candidate.subjectId === target.subjectId
    && candidate.exerciseVersionId === prescription.exerciseVersionId
    && candidate.equipmentId === prescription.equipmentId
    && candidate.loadBasis === prescription.loadBasis
    && candidate.side === prescription.side
    && candidate.rom === prescription.rom
    && candidate.tempo === prescription.tempo
    && candidate.prescribedWorkingSets === prescription.prescribedWorkingSets
    && sameRange(candidate.repRange, prescription.repRange)
    && sameRange(candidate.targetRir, prescription.targetRir)
    && candidate.exposureType === prescription.exposureType
    && candidate.loadEpoch === prescription.loadEpoch
    && sameBodyweightAssistancePolicy(
      candidate.bodyweightAssistancePolicy,
      prescription.bodyweightAssistancePolicy,
    )
}

function effectiveEvents(
  raw: unknown,
  evidence: ReadyStrengthSessionEvidenceV1,
): TrainingSetLogEventV1[] | null {
  const parsed = evidenceEventsSchema.safeParse(raw)
  const identity = z.object({ exerciseInstanceId: TrainingStableIdV1Schema }).passthrough().safeParse(raw)
  if (!parsed.success || !identity.success) return null
  const bySet = new Map<string, TrainingSetLogEventV1[]>()
  for (const event of parsed.data.currentEvents) {
    if (event.exerciseInstanceId !== identity.data.exerciseInstanceId) continue
    const group = bySet.get(event.setId)
    if (group) group.push(event)
    else bySet.set(event.setId, [event])
  }
  const result = [...bySet.values()].map(group => (
    [...group].sort((left, right) => right.eventRevision - left.eventRevision)[0]
  )).sort((left, right) => (left.workingSetOrdinal ?? 0) - (right.workingSetOrdinal ?? 0))
  return result.length === evidence.exposure.sets.length ? result : null
}

function qualifies(evidence: ReadyStrengthSessionEvidenceV1, target: ReadyStrengthSessionEvidenceV1) {
  const exposure = evidence.exposure
  return evidence.progressionSeriesId === target.progressionSeriesId
    && executionContextsMatch(evidence.executionContext, target.executionContext)
    && comparatorsMatch(exposure.comparator, target)
    && (exposure.sessionState === 'completed' || exposure.sessionState === 'completed_with_omissions')
    && exposure.exerciseState === 'completed'
    && exposure.syncState === 'acknowledged'
    && exposure.completedAt !== null
    && exposure.provenance.kind === 'in_app'
    && exposure.sets.length === exposure.comparator.prescribedWorkingSets
    && exposure.sets.every(set => set.kind === 'working'
      && set.validity === 'valid'
      && set.actualReps > 0
      && set.symptom === 'none'
      && set.load.equipmentId === exposure.comparator.equipmentId
      && set.load.basis === exposure.comparator.loadBasis)
}

export async function readPreviousComparablePerformance(
  client: PreviousPerformanceReadClient,
  sessionId: string,
  exerciseInstanceId: string,
): Promise<PreviousPerformanceReadResultV1> {
  if (!TrainingStableIdV1Schema.safeParse(sessionId).success
    || !TrainingStableIdV1Schema.safeParse(exerciseInstanceId).success) return { kind: 'invalid_request' }
  const { data, error } = await client.rpc('read_training_previous_performance_sources', {
    p_session_id: sessionId, p_exercise_instance_id: exerciseInstanceId,
  })
  if (error) return response(sessionId, exerciseInstanceId, { kind: 'unavailable', reason: 'persistence_unavailable' })
  if (data === null) return { kind: 'not_found' }
  const source = sourceEnvelopeSchema.safeParse(data)
  if (!source.success) {
    return response(sessionId, exerciseInstanceId, { kind: 'unavailable', reason: 'current_comparator_unavailable' })
  }
  const target = adaptStrengthSessionEvidence(source.data.current)
  if (target.kind !== 'ready') {
    return response(sessionId, exerciseInstanceId, { kind: 'unavailable', reason: 'current_comparator_unavailable' })
  }
  const currentIdentity = z.object({
    session: z.object({ sessionId: TrainingStableIdV1Schema }).passthrough(),
    exerciseInstanceId: TrainingStableIdV1Schema,
  }).passthrough().safeParse(source.data.current)
  if (!currentIdentity.success
    || currentIdentity.data.session.sessionId !== sessionId
    || currentIdentity.data.exerciseInstanceId !== exerciseInstanceId) {
    return response(sessionId, exerciseInstanceId, { kind: 'unavailable', reason: 'current_comparator_unavailable' })
  }
  const matches: { scheduledLocalDate: string; evidence: ReadyStrengthSessionEvidenceV1; raw: unknown }[] = []
  for (const item of source.data.history) {
    const candidate = adaptStrengthSessionEvidence(item.evidence)
    if (candidate.kind !== 'ready') {
      return response(sessionId, exerciseInstanceId, { kind: 'unavailable', reason: 'historical_evidence_unavailable' })
    }
    if (qualifies(candidate, target)) matches.push({ scheduledLocalDate: item.scheduledLocalDate, evidence: candidate, raw: item.evidence })
  }
  matches.sort((left, right) => {
    const byCompletion = Date.parse(right.evidence.exposure.completedAt!) - Date.parse(left.evidence.exposure.completedAt!)
    return byCompletion || right.evidence.exposure.sourceRevisionId.localeCompare(left.evidence.exposure.sourceRevisionId)
  })
  const latest = matches[0]
  if (!latest) return response(sessionId, exerciseInstanceId, { kind: 'none', reason: 'no_comparable_completed_exposure' })
  const events = effectiveEvents(latest.raw, latest.evidence)
  if (!events) {
    return response(sessionId, exerciseInstanceId, { kind: 'unavailable', reason: 'historical_evidence_unavailable' })
  }
  const rawSession = z.object({
    session: z.object({ sessionId: TrainingStableIdV1Schema, revision: z.number().int().positive() }).passthrough(),
    exerciseInstanceId: TrainingStableIdV1Schema,
  }).passthrough().safeParse(latest.raw)
  if (!rawSession.success) {
    return response(sessionId, exerciseInstanceId, { kind: 'unavailable', reason: 'historical_evidence_unavailable' })
  }
  return response(sessionId, exerciseInstanceId, {
    kind: 'available',
    source: {
      sessionId: rawSession.data.session.sessionId,
      exerciseInstanceId: rawSession.data.exerciseInstanceId,
      sessionRevision: rawSession.data.session.revision,
      sourceRevisionId: latest.evidence.exposure.sourceRevisionId,
      prescriptionSourceRevisionId: latest.evidence.exposure.acceptedPrescription.sourceRevisionId,
      progressionSeriesId: latest.evidence.progressionSeriesId,
      scheduledLocalDate: latest.scheduledLocalDate,
      completedAt: latest.evidence.exposure.completedAt!,
      executionContext: latest.evidence.executionContext,
      ...(latest.evidence.exposure.comparator.bodyweightAssistancePolicy
        ? { bodyweightAssistancePolicy: latest.evidence.exposure.comparator.bodyweightAssistancePolicy }
        : {}),
      effectiveEvents: events.map(event => ({ eventId: event.eventId, eventRevision: event.eventRevision })),
    },
    sets: latest.evidence.exposure.sets.map(set => ({
      ordinal: set.ordinal, load: set.load, reps: set.actualReps, rir: set.actualRir,
      side: latest.evidence.exposure.comparator.side as 'bilateral' | 'left' | 'right' | 'not_applicable',
    })),
  })
}
