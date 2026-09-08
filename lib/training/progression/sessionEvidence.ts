import { createHash } from 'node:crypto'
import { z } from 'zod'
import { TrainingSetLogEventV1Schema, type TrainingSetLogEventV1 } from '../contracts/logs'
import {
  TrainingSessionPrescriptionV1Schema,
  type TrainingSessionPrescriptionV1,
} from '../contracts/session'
import {
  ExecutionContextV1Schema,
  TrainingStableIdV1Schema,
  executionContextsMatch,
  type ExecutionContextV1,
} from '../contracts/program'
import type {
  ProgressionComparatorV1,
  StrengthExposureV1,
  StrengthPrescriptionV1,
} from './types'

const stableReferenceSchema = z.string().trim().min(1).max(160)
const utcTimestampSchema = z.string().datetime({ offset: true }).refine(value => value.endsWith('Z'))
export const STRENGTH_SESSION_PROGRESSION_METADATA_SCHEMA_VERSION = 'strength-session-progression-metadata.v1' as const

const sessionProjectionSchema = z.object({
  sessionId: stableReferenceSchema,
  revision: z.number().int().positive(),
  state: z.enum(['in_progress', 'completed', 'completed_with_omissions', 'aborted']),
  stoppedForSymptoms: z.boolean(),
}).strict()

const comparatorMetadataSchema = z.object({
  side: stableReferenceSchema,
  rom: stableReferenceSchema,
  tempo: stableReferenceSchema,
  exposureType: stableReferenceSchema,
  loadEpoch: z.number().int().min(0),
}).strict()

const metadataEnvelopeSchema = z.object({
  schemaVersion: z.literal(STRENGTH_SESSION_PROGRESSION_METADATA_SCHEMA_VERSION).optional(),
  prescriptionSourceRevisionId: stableReferenceSchema.optional(),
  progressionSeriesId: TrainingStableIdV1Schema.optional(),
  startedAt: utcTimestampSchema.optional(),
  completedAt: utcTimestampSchema.nullable().optional(),
  comparator: comparatorMetadataSchema.partial().optional(),
}).strict()

export const StrengthSessionProgressionMetadataV1Schema = z.object({
  schemaVersion: z.literal(STRENGTH_SESSION_PROGRESSION_METADATA_SCHEMA_VERSION),
  prescriptionSourceRevisionId: stableReferenceSchema,
  progressionSeriesId: TrainingStableIdV1Schema,
  startedAt: utcTimestampSchema,
  completedAt: utcTimestampSchema.nullable(),
  comparator: comparatorMetadataSchema,
}).strict()

export type StrengthSessionProgressionMetadataV1 = z.infer<typeof StrengthSessionProgressionMetadataV1Schema>

export interface StrengthSessionEvidenceAdapterInputV1 {
  readonly session: {
    readonly sessionId: string
    readonly revision: number
    readonly state: 'in_progress' | 'completed' | 'completed_with_omissions' | 'aborted'
    readonly stoppedForSymptoms: boolean
  }
  readonly prescription: TrainingSessionPrescriptionV1
  readonly exerciseInstanceId: string
  readonly executionContext?: ExecutionContextV1
  /** The append-only saved events; corrections are collapsed by set to their highest revision. */
  readonly currentEvents: readonly TrainingSetLogEventV1[]
  readonly metadata: StrengthSessionProgressionMetadataV1
}

const inputEnvelopeSchema = z.object({
  session: sessionProjectionSchema,
  prescription: TrainingSessionPrescriptionV1Schema,
  exerciseInstanceId: stableReferenceSchema,
  executionContext: ExecutionContextV1Schema.optional(),
  currentEvents: z.array(TrainingSetLogEventV1Schema).max(600),
  metadata: metadataEnvelopeSchema.optional(),
}).strict()

export interface SessionEvidenceUnavailableV1 {
  readonly kind: 'unavailable'
  readonly reason: 'missing_server_metadata' | 'invalid_server_projection'
  readonly missingFields: readonly string[]
}

export interface ReadyStrengthSessionEvidenceV1 {
  readonly kind: 'ready'
  readonly schemaVersion: 'strength-session-evidence.v1'
  readonly subjectId: string
  readonly sourceProfileRevisionId: string
  readonly programRevisionId: string
  readonly progressionSeriesId: string
  readonly executionContext: ExecutionContextV1
  readonly prescription: StrengthPrescriptionV1
  readonly exposure: StrengthExposureV1
}

export type StrengthSessionEvidenceResultV1 =
  | SessionEvidenceUnavailableV1
  | ReadyStrengthSessionEvidenceV1

export interface ProgressionReadySessionEvidenceV1 {
  readonly schemaVersion: 'progression-ready-session-evidence.v1'
  readonly subjectId: string
  readonly sourceProfileRevisionId: string
  readonly programRevisionId: string
  readonly progressionSeriesId: string
  readonly executionContext: ExecutionContextV1
  readonly prescription: StrengthPrescriptionV1
  readonly exposures: readonly StrengthExposureV1[]
  readonly excluded: readonly {
    readonly sourceRevisionId: string
    readonly reason:
      | 'execution_context_mismatch'
      | 'subject_mismatch'
      | 'program_mismatch'
      | 'progression_series_mismatch'
      | 'duplicate_source_revision'
  }[]
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, canonicalize(nested)]))
  }
  return value
}

function evidenceRevision(value: unknown): string {
  const digest = createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex')
  return `session-evidence:${digest}`
}

function missingMetadataFields(raw: unknown): string[] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return [
      'metadata.schemaVersion', 'metadata.prescriptionSourceRevisionId', 'metadata.progressionSeriesId',
      'metadata.startedAt', 'metadata.completedAt',
      'metadata.comparator.side', 'metadata.comparator.rom', 'metadata.comparator.tempo',
      'metadata.comparator.exposureType', 'metadata.comparator.loadEpoch',
    ]
  }
  const metadata = raw as Record<string, unknown>
  const missing: string[] = []
  if (!Object.hasOwn(metadata, 'schemaVersion')) missing.push('metadata.schemaVersion')
  if (!Object.hasOwn(metadata, 'prescriptionSourceRevisionId')) missing.push('metadata.prescriptionSourceRevisionId')
  if (!Object.hasOwn(metadata, 'progressionSeriesId')) missing.push('metadata.progressionSeriesId')
  if (!Object.hasOwn(metadata, 'startedAt')) missing.push('metadata.startedAt')
  if (!Object.hasOwn(metadata, 'completedAt')) missing.push('metadata.completedAt')
  const comparator = metadata.comparator
  if (!comparator || typeof comparator !== 'object' || Array.isArray(comparator)) {
    return [...missing,
      'metadata.comparator.side', 'metadata.comparator.rom', 'metadata.comparator.tempo',
      'metadata.comparator.exposureType', 'metadata.comparator.loadEpoch']
  }
  const record = comparator as Record<string, unknown>
  for (const key of ['side', 'rom', 'tempo', 'exposureType', 'loadEpoch']) {
    if (!Object.hasOwn(record, key)) missing.push(`metadata.comparator.${key}`)
  }
  return missing
}

function unavailable(
  reason: SessionEvidenceUnavailableV1['reason'],
  missingFields: readonly string[] = [],
): SessionEvidenceUnavailableV1 {
  return Object.freeze({ kind: 'unavailable', reason, missingFields: Object.freeze([...missingFields]) })
}

function currentEvents(events: readonly TrainingSetLogEventV1[]): TrainingSetLogEventV1[] | null {
  const eventsById = new Map(events.map(event => [event.eventId, event] as const))
  if (eventsById.size !== events.length) return null
  const bySet = new Map<string, TrainingSetLogEventV1[]>()
  for (const event of events) {
    const group = bySet.get(event.setId)
    if (group) group.push(event)
    else bySet.set(event.setId, [event])
  }
  const current: TrainingSetLogEventV1[] = []
  for (const group of bySet.values()) {
    group.sort((left, right) => left.eventRevision - right.eventRevision || left.eventId.localeCompare(right.eventId))
    if (new Set(group.map(event => event.eventRevision)).size !== group.length) return null
    for (const event of group) {
      if (event.replacesEventId === null) continue
      const replaced = eventsById.get(event.replacesEventId)
      if (replaced && (replaced.setId !== event.setId || replaced.eventRevision >= event.eventRevision)) return null
    }
    current.push(group[group.length - 1])
  }
  return current
}

function exactLoad(event: TrainingSetLogEventV1) {
  return {
    equipmentId: event.equipmentId,
    basis: event.loadBasis,
    quantity: event.quantity,
  }
}

export function adaptStrengthSessionEvidence(raw: unknown): StrengthSessionEvidenceResultV1 {
  const rawRecord = raw && typeof raw === 'object' && !Array.isArray(raw)
    ? raw as Record<string, unknown>
    : null
  const missing = missingMetadataFields(rawRecord?.metadata)
  if (missing.length > 0) return unavailable('missing_server_metadata', missing)
  const parsed = inputEnvelopeSchema.safeParse(raw)
  if (!parsed.success) return unavailable('invalid_server_projection')
  const { session, prescription, exerciseInstanceId, executionContext, metadata } = parsed.data
  const completeMetadata = StrengthSessionProgressionMetadataV1Schema.safeParse(metadata)
  if (!completeMetadata.success
    || session.sessionId !== prescription.sessionId
    || (executionContext !== undefined && !executionContextsMatch(executionContext, prescription.executionContext))) {
    return unavailable('invalid_server_projection')
  }
  const {
    schemaVersion: metadataSchemaVersion,
    prescriptionSourceRevisionId,
    progressionSeriesId,
    startedAt,
    completedAt,
    comparator: comparatorMetadata,
  } = completeMetadata.data
  if (session.state === 'in_progress' ? completedAt !== null : completedAt === null) {
    return unavailable('invalid_server_projection')
  }
  if (completedAt !== null && Date.parse(completedAt) < Date.parse(startedAt)) {
    return unavailable('invalid_server_projection')
  }
  const exercise = prescription.exercises.find(item => item.exerciseInstanceId === exerciseInstanceId)
  if (!exercise) return unavailable('invalid_server_projection')
  const authoredProgression = exercise.progression
  if (!authoredProgression
    || authoredProgression.progressionSeriesId !== progressionSeriesId
    || authoredProgression.side !== comparatorMetadata.side
    || authoredProgression.rom !== comparatorMetadata.rom
    || authoredProgression.tempo !== comparatorMetadata.tempo
    || authoredProgression.exposureType !== comparatorMetadata.exposureType
    || authoredProgression.loadEpoch !== comparatorMetadata.loadEpoch) {
    return unavailable('invalid_server_projection')
  }

  const allSetIds = new Map(prescription.exercises.flatMap(item => item.setIds.map((setId, index) => [setId, {
    exerciseInstanceId: item.exerciseInstanceId,
    workingSetOrdinal: index + 1,
    side: item.progression?.side,
  }] as const)))
  if (allSetIds.size !== prescription.exercises.reduce((sum, item) => sum + item.setIds.length, 0)) {
    return unavailable('invalid_server_projection')
  }
  if (parsed.data.currentEvents.some(event => (
    event.subjectId !== prescription.subjectId
    || event.sessionId !== prescription.sessionId
    || !executionContextsMatch(event.executionContext, prescription.executionContext)
    || allSetIds.get(event.setId)?.exerciseInstanceId !== event.exerciseInstanceId
    || allSetIds.get(event.setId)?.workingSetOrdinal !== event.workingSetOrdinal
    || allSetIds.get(event.setId)?.side !== event.side
    || event.setKind !== 'working'
  ))) return unavailable('invalid_server_projection')

  const selectedCurrent = currentEvents(parsed.data.currentEvents)
  if (!selectedCurrent) return unavailable('invalid_server_projection')
  const currentByExercise = new Map<string, TrainingSetLogEventV1[]>()
  for (const event of selectedCurrent) {
    const group = currentByExercise.get(event.exerciseInstanceId)
    if (group) group.push(event)
    else currentByExercise.set(event.exerciseInstanceId, [event])
  }
  // A completed-with-omissions session omits only exercises with no current saved
  // records. Any record, including a zero-rep record, makes that exercise incomplete.
  const omittedExerciseInstanceIds = session.state === 'completed_with_omissions'
    ? prescription.exercises.filter(item => (currentByExercise.get(item.exerciseInstanceId)?.length ?? 0) === 0)
      .map(item => item.exerciseInstanceId)
    : []
  const targetEvents = (currentByExercise.get(exercise.exerciseInstanceId) ?? [])
    .sort((left, right) => (left.workingSetOrdinal ?? 0) - (right.workingSetOrdinal ?? 0))
  const completeSetIds = new Set(targetEvents.filter(event => event.reps > 0).map(event => event.setId))
  const hasEveryCompletedSet = exercise.setIds.every(setId => completeSetIds.has(setId))
  const exerciseState: StrengthExposureV1['exerciseState'] = session.state === 'aborted' || session.stoppedForSymptoms
    ? 'aborted'
    : omittedExerciseInstanceIds.includes(exercise.exerciseInstanceId)
      ? 'omitted'
      : hasEveryCompletedSet
        ? 'completed'
        : 'incomplete'
  const sessionState: StrengthExposureV1['sessionState'] = session.stoppedForSymptoms ? 'aborted' : session.state
  const acceptedLoad = {
    equipmentId: exercise.acceptedInitialLoad.equipmentId,
    basis: exercise.acceptedInitialLoad.loadBasis,
    quantity: exercise.acceptedInitialLoad.quantity,
  }
  const comparator: ProgressionComparatorV1 = {
    subjectId: prescription.subjectId,
    exerciseVersionId: exercise.exerciseVersionId,
    equipmentId: exercise.acceptedInitialLoad.equipmentId,
    loadBasis: exercise.acceptedInitialLoad.loadBasis,
    side: comparatorMetadata.side,
    rom: comparatorMetadata.rom,
    tempo: comparatorMetadata.tempo,
    prescribedWorkingSets: exercise.setIds.length,
    repRange: { min: exercise.repRange.minimum, max: exercise.repRange.maximum },
    targetRir: { min: exercise.targetRir.minimum, max: exercise.targetRir.maximum },
    exposureType: comparatorMetadata.exposureType,
    loadEpoch: comparatorMetadata.loadEpoch,
  }
  const progressionPrescription: StrengthPrescriptionV1 = {
    prescriptionId: `${prescription.sessionId}:${exercise.exerciseInstanceId}`,
    prescribedLoad: acceptedLoad,
    exerciseVersionId: comparator.exerciseVersionId,
    equipmentId: comparator.equipmentId,
    loadBasis: comparator.loadBasis,
    side: comparator.side,
    rom: comparator.rom,
    tempo: comparator.tempo,
    prescribedWorkingSets: comparator.prescribedWorkingSets,
    repRange: comparator.repRange,
    targetRir: comparator.targetRir,
    exposureType: comparator.exposureType,
    loadEpoch: comparator.loadEpoch,
  }
  const sets = targetEvents.map(event => ({
    setId: event.setId,
    ordinal: event.workingSetOrdinal ?? 0,
    kind: event.setKind,
    actualReps: event.reps,
    actualRir: event.rir,
    load: exactLoad(event),
    symptom: event.symptomState === 'adverse_reported' ? 'adverse' as const : 'none' as const,
    validity: event.reps > 0 ? 'valid' as const : 'invalid' as const,
  }))
  const sourceRevisionId = evidenceRevision({
    sessionId: session.sessionId, sessionRevision: session.revision,
    metadataSchemaVersion, prescriptionSourceRevisionId, progressionSeriesId,
    exerciseInstanceId, state: sessionState, stoppedForSymptoms: session.stoppedForSymptoms,
    startedAt, completedAt, comparator: comparatorMetadata, omittedExerciseInstanceIds,
    events: targetEvents.map(event => ({ eventId: event.eventId, eventRevision: event.eventRevision })),
  })
  const exposure: StrengthExposureV1 = {
    sourceRevisionId,
    executionContext: prescription.executionContext,
    provenance: { kind: 'in_app', sourceVersion: 'training-log.v1' },
    acceptedPrescription: {
      sourceRevisionId: prescriptionSourceRevisionId,
      load: acceptedLoad,
    },
    sessionState,
    exerciseState,
    syncState: 'acknowledged',
    startedAt,
    completedAt,
    omittedExerciseInstanceIds,
    comparator,
    sets,
  }
  return Object.freeze({
    kind: 'ready', schemaVersion: 'strength-session-evidence.v1',
    subjectId: prescription.subjectId,
    sourceProfileRevisionId: prescription.profileRevisionId,
    programRevisionId: prescription.compiledProgramRevisionId,
    progressionSeriesId,
    executionContext: prescription.executionContext,
    prescription: progressionPrescription,
    exposure,
  })
}

export function buildProgressionReadySessionEvidence(
  target: ReadyStrengthSessionEvidenceV1,
  candidates: readonly ReadyStrengthSessionEvidenceV1[],
): ProgressionReadySessionEvidenceV1 {
  const exposures: StrengthExposureV1[] = []
  const excluded: ProgressionReadySessionEvidenceV1['excluded'][number][] = []
  const includedSourceRevisionIds = new Set<string>()
  for (const candidate of candidates) {
    const sourceRevisionId = candidate.exposure.sourceRevisionId
    if (!executionContextsMatch(candidate.executionContext, target.executionContext)) {
      excluded.push({ sourceRevisionId, reason: 'execution_context_mismatch' })
    } else if (candidate.subjectId !== target.subjectId) {
      excluded.push({ sourceRevisionId, reason: 'subject_mismatch' })
    } else if (candidate.programRevisionId !== target.programRevisionId) {
      excluded.push({ sourceRevisionId, reason: 'program_mismatch' })
    } else if (candidate.progressionSeriesId !== target.progressionSeriesId) {
      excluded.push({ sourceRevisionId, reason: 'progression_series_mismatch' })
    } else if (includedSourceRevisionIds.has(sourceRevisionId)) {
      excluded.push({ sourceRevisionId, reason: 'duplicate_source_revision' })
    } else {
      includedSourceRevisionIds.add(sourceRevisionId)
      exposures.push(candidate.exposure)
    }
  }
  return Object.freeze({
    schemaVersion: 'progression-ready-session-evidence.v1',
    subjectId: target.subjectId,
    sourceProfileRevisionId: target.sourceProfileRevisionId,
    programRevisionId: target.programRevisionId,
    progressionSeriesId: target.progressionSeriesId,
    executionContext: target.executionContext,
    prescription: target.prescription,
    exposures: Object.freeze(exposures),
    excluded: Object.freeze(excluded),
  })
}
