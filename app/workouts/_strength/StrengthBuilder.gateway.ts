import type { InitialLoadCalibrationV1 } from '@/lib/training/contracts/calibration'
import type { CompilationResultV1 } from '@/lib/training/engine/compileProgram'

export const TRAINING_BUILD_PROJECTION_VERSION = 'training-build-projection.v1' as const
export const TRAINING_BUILD_ACCEPTANCE_VERSION = 'training-build-acceptance.v1' as const

export type TrainingBuildProjection = {
  schemaVersion: typeof TRAINING_BUILD_PROJECTION_VERSION
  buildId: string | null
  result: CompilationResultV1
  calibrations: readonly { exerciseLabel: string; calibration: InitialLoadCalibrationV1 }[]
}

export type StartingTargetsSelection = {
  loadChoices: readonly { exerciseInstanceId: string; optionIndex: number }[]
  conditioningChoices: readonly { boutId: string; acceptedDurationSeconds: number }[]
}

export type CreatedTrainingProgram = {
  status: 'accepted'
  draftId: string
  assignmentId: string
  firstStrengthSessionId: string | null
  firstConditioningSessionId: string | null
}

export type AcceptedTrainingBuild = { status: 'accepted'; draftId: string }

export type TrainingProgramListProjection = {
  schemaVersion: 'training-program-list.v1'
  subjectId: string
  programs: readonly {
    id: string
    subject_id: string
    program_mode: 'self_directed' | 'coach_assigned'
    simulation_run_id: string | null
    status: 'active' | 'ended'
    created_at: string
    sessions: readonly {
      id: string
      session_kind: 'strength' | 'conditioning'
      state: 'scheduled' | 'in_progress' | 'completed' | 'completed_with_omissions' | 'aborted'
      scheduled_local_date: string
      athlete_timezone: string
      revision: number
    }[]
  }[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isTrainingBuildProjection(value: unknown): value is TrainingBuildProjection {
  if (!isRecord(value) || value.schemaVersion !== TRAINING_BUILD_PROJECTION_VERSION) return false
  if (value.buildId !== null && (typeof value.buildId !== 'string' || value.buildId.length === 0)) return false
  if (!isRecord(value.result) || typeof value.result.kind !== 'string' || !Array.isArray(value.calibrations)) return false
  if ((value.result.kind === 'draft_program') !== (typeof value.buildId === 'string')) return false
  return value.calibrations.every(item => isRecord(item)
    && typeof item.exerciseLabel === 'string'
    && isRecord(item.calibration)
    && typeof item.calibration.exerciseInstanceId === 'string'
    && typeof item.calibration.exerciseVersionId === 'string'
    && Array.isArray(item.calibration.options))
}

async function jsonResponse(response: Response): Promise<unknown> {
  return response.json().catch(() => null)
}

export async function requestTrainingBuild(input: {
  subjectId: string
  profileRevision: number
  cycleStartLocalDate: string
}): Promise<TrainingBuildProjection> {
  const response = await fetch('/api/training/programs/builds', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  })
  const body = await jsonResponse(response)
  if (!response.ok) throw new Error('Training program could not be built.')
  if (!isTrainingBuildProjection(body)) throw new Error('Training build response was invalid.')
  return body
}

export async function requestTrainingPrograms(subjectId: string): Promise<TrainingProgramListProjection> {
  const response = await fetch(`/api/training/programs?subjectId=${encodeURIComponent(subjectId)}`, { cache: 'no-store' })
  const body = await jsonResponse(response)
  if (!response.ok) throw new Error('Saved training programs could not be loaded.')
  if (!isRecord(body)
    || body.schemaVersion !== 'training-program-list.v1'
    || body.subjectId !== subjectId
    || !Array.isArray(body.programs)) {
    throw new Error('Training program list response was invalid.')
  }
  return body as TrainingProgramListProjection
}

export async function acceptTrainingBuild(
  buildId: string,
  selection: StartingTargetsSelection,
): Promise<AcceptedTrainingBuild> {
  const acceptanceResponse = await fetch(`/api/training/programs/builds/${encodeURIComponent(buildId)}/accept`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(selection),
  })
  const acceptance = await jsonResponse(acceptanceResponse)
  if (!acceptanceResponse.ok) throw new Error('Starting targets could not be accepted.')
  if (!isRecord(acceptance)
    || acceptance.schemaVersion !== TRAINING_BUILD_ACCEPTANCE_VERSION
    || acceptance.buildId !== buildId
    || typeof acceptance.draftId !== 'string'
    || !acceptance.draftId) {
    throw new Error('Training acceptance response was invalid.')
  }

  return { status: 'accepted', draftId: acceptance.draftId }
}

export async function publishTrainingDraft(draftId: string): Promise<CreatedTrainingProgram> {
  const publishResponse = await fetch('/api/training/programs/publish', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ draftId }),
  })
  const published = await jsonResponse(publishResponse)
  if (!publishResponse.ok) throw new Error('Program was accepted but could not be published. Retry publishing this draft.')
  if (!isRecord(published) || typeof published.assignmentId !== 'string' || !published.assignmentId) {
    throw new Error('Training publish response was invalid.')
  }
  let firstStrengthSessionId: string | null = null
  let firstConditioningSessionId: string | null = null
  try {
    const programResponse = await fetch(`/api/training/programs/${encodeURIComponent(published.assignmentId)}`, { cache: 'no-store' })
    const programProjection = await jsonResponse(programResponse)
    if (programResponse.ok && isRecord(programProjection) && isRecord(programProjection.program)) {
      const sessions = Array.isArray(programProjection.program.sessions) ? programProjection.program.sessions : []
      const conditioningBouts = Array.isArray(programProjection.program.conditioningBouts) ? programProjection.program.conditioningBouts : []
      const firstSession = sessions.find(item => isRecord(item) && typeof item.sessionId === 'string')
      const firstBout = conditioningBouts.find(item => isRecord(item) && typeof item.boutId === 'string')
      firstStrengthSessionId = firstSession && isRecord(firstSession) ? firstSession.sessionId as string : null
      firstConditioningSessionId = firstBout && isRecord(firstBout) ? firstBout.boutId as string : null
    }
  } catch {
    // Publication already succeeded; the Workouts library can recover links on refresh.
  }
  return {
    status: 'accepted', draftId, assignmentId: published.assignmentId,
    firstStrengthSessionId, firstConditioningSessionId,
  }
}
