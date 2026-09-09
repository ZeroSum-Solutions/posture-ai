import type { ManualRoutine, ManualRoutineListPage, ManualRoutineSaveInput } from './ManualRoutine.types'
import {
  ManualReferenceRoutineArchiveV1Schema,
  ManualReferenceRoutineListV1Schema,
  ManualReferenceRoutineProjectionV1Schema,
  ManualReferenceRoutineV1Schema,
} from '@/lib/training/contracts/manual-reference-routine'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function routineFrom(value: unknown): ManualRoutine | null {
  const parsed = ManualReferenceRoutineProjectionV1Schema.safeParse(value)
  return parsed.success ? parsed.data.routine : null
}

async function json(response: Response): Promise<unknown> {
  return response.json().catch(() => null)
}

function message(status: number, body: unknown, fallback: string): string {
  const code = isRecord(body) && typeof body.error === 'string' ? body.error : ''
  if (status === 403) return 'This routine is not available for the selected athlete.'
  if (code === 'manual_routine_invalid_reference') return 'One or more exercises are no longer available in the reference library.'
  if (status === 422) return 'Review the routine name and every exercise target.'
  return fallback
}

export class ManualRoutineConflictError extends Error {
  constructor(readonly current: ManualRoutine | null) {
    super('This routine changed elsewhere. Reload the saved version before trying again.')
    this.name = 'ManualRoutineConflictError'
  }
}

export type ManualRoutineCreateAttempt = Readonly<{
  requestId: string
  subjectId: string
  body: string
}>

export class ManualRoutineCreateError extends Error {
  constructor(message: string, readonly uncertain: boolean) {
    super(message)
    this.name = 'ManualRoutineCreateError'
  }
}

export function createManualRoutineAttempt(
  subjectId: string,
  input: ManualRoutineSaveInput,
  createRequestId: () => string = () => crypto.randomUUID(),
): ManualRoutineCreateAttempt {
  const requestId = createRequestId()
  return Object.freeze({
    requestId,
    subjectId,
    body: JSON.stringify({ requestId, subjectId, ...input }),
  })
}

export async function createManualRoutine(attempt: ManualRoutineCreateAttempt): Promise<ManualRoutine> {
  let response: Response
  try {
    response = await fetch('/api/training/manual-routines', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: attempt.body,
    })
  } catch {
    throw new ManualRoutineCreateError('Routine save outcome is uncertain. Retry the original save.', true)
  }
  const body = await json(response)
  if (!response.ok) {
    throw new ManualRoutineCreateError(
      message(response.status, body, 'Routine could not be saved.'),
      response.status === 408 || response.status >= 500,
    )
  }
  const routine = routineFrom(body)
  if (!routine || routine.subjectId !== attempt.subjectId) {
    throw new ManualRoutineCreateError('Routine save response was invalid. Retry the original save.', true)
  }
  return routine
}

export async function loadManualRoutine(routineId: string): Promise<ManualRoutine> {
  const response = await fetch(`/api/training/manual-routines/${encodeURIComponent(routineId)}`, { cache: 'no-store' })
  const body = await json(response)
  if (!response.ok) throw new Error(message(response.status, body, response.status === 404 ? 'Routine was not found.' : 'Routine could not be loaded.'))
  const routine = routineFrom(body)
  if (!routine || routine.routineId !== routineId) throw new Error('Routine response was invalid.')
  return routine
}

export async function loadManualRoutines(subjectId: string, cursor?: string): Promise<ManualRoutineListPage> {
  const query = new URLSearchParams({ subjectId, limit: '20' })
  if (cursor) query.set('cursor', cursor)
  const response = await fetch(`/api/training/manual-routines?${query.toString()}`, { cache: 'no-store' })
  const body = await json(response)
  if (!response.ok) throw new Error(message(response.status, body, 'Saved routines could not be loaded.'))
  const parsed = ManualReferenceRoutineListV1Schema.safeParse(body)
  if (!parsed.success || parsed.data.subjectId !== subjectId) throw new Error('Saved routines response was invalid.')
  return {
    routines: parsed.data.routines,
    hasMore: parsed.data.hasMore,
    nextCursor: parsed.data.nextCursor,
  }
}

export async function updateManualRoutine(routine: ManualRoutine, input: ManualRoutineSaveInput): Promise<ManualRoutine> {
  const response = await fetch(`/api/training/manual-routines/${encodeURIComponent(routine.routineId)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ expectedRevision: routine.revision, ...input }),
  })
  const body = await json(response)
  if (response.status === 409) {
    const parsedCurrent = isRecord(body) ? ManualReferenceRoutineV1Schema.safeParse(body.current) : null
    const current = parsedCurrent?.success ? parsedCurrent.data : null
    throw new ManualRoutineConflictError(current)
  }
  if (!response.ok) throw new Error(message(response.status, body, 'Routine changes could not be saved.'))
  const updated = routineFrom(body)
  if (!updated || updated.routineId !== routine.routineId || updated.revision <= routine.revision) throw new Error('Routine update response was invalid.')
  return updated
}

export async function archiveManualRoutine(routine: ManualRoutine): Promise<void> {
  const response = await fetch(`/api/training/manual-routines/${encodeURIComponent(routine.routineId)}`, {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ expectedRevision: routine.revision }),
  })
  const body = await json(response)
  if (response.status === 409) {
    const parsedCurrent = isRecord(body) ? ManualReferenceRoutineV1Schema.safeParse(body.current) : null
    const current = parsedCurrent?.success ? parsedCurrent.data : null
    throw new ManualRoutineConflictError(current)
  }
  if (!response.ok) throw new Error(message(response.status, body, 'Routine could not be archived.'))
  const archive = ManualReferenceRoutineArchiveV1Schema.safeParse(body)
  if (!archive.success || archive.data.routineId !== routine.routineId) {
    throw new Error('Routine archive response was invalid.')
  }
}

export async function resolveManualRoutineSubject(clientId: string, signal?: AbortSignal): Promise<string> {
  const response = await fetch(`/api/training/profile?clientId=${encodeURIComponent(clientId)}`, { cache: 'no-store', signal })
  const body = await json(response)
  if (!response.ok) throw new Error(response.status === 409 ? 'Connect this client to an athlete training account first.' : 'Athlete access could not be loaded.')
  if (!isRecord(body) || body.schemaVersion !== 'training-profile-projection.v1' || body.clientId !== clientId || !UUID.test(String(body.subjectId))) {
    throw new Error('Athlete access response was invalid.')
  }
  return String(body.subjectId)
}
