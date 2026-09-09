import { z } from 'zod'
import {
  ArchiveManualReferenceRoutineV1Schema,
  UpdateManualReferenceRoutineV1Schema,
} from '@/lib/training/contracts/manual-reference-routine'
import {
  ManualReferenceRoutineError,
  archiveManualReferenceRoutine,
  readManualReferenceRoutine,
  updateManualReferenceRoutine,
} from '@/lib/training/persistence/manual-reference-routine'
import { trainingRequestContext } from '@/lib/training/persistence/request-context'
import { parseManualReferenceRoutineBody } from '@/lib/training/persistence/manual-reference-routine-http'
import { trainingJson } from '@/lib/training/persistence/session-http'

function routineError(error: unknown) {
  if (error instanceof z.ZodError) return trainingJson({ error: 'invalid_training_payload' }, 422)
  if (!(error instanceof ManualReferenceRoutineError)) return trainingJson({ error: 'manual_routine_unavailable' }, 503)
  if (error.code === 'manual_routine_conflict') {
    return trainingJson({ error: error.code, current: error.current }, 409)
  }
  if (error.code === 'manual_routine_forbidden') return trainingJson({ error: error.code }, 403)
  if (error.code === 'manual_routine_invalid_reference') return trainingJson({ error: error.code }, 422)
  return trainingJson({ error: error.code }, 503)
}

type RouteContext = { params: Promise<{ routineId: string }> }

async function routineId(context: RouteContext) {
  const parsed = z.string().uuid().safeParse((await context.params).routineId)
  return parsed.success ? parsed.data : null
}

export async function GET(_request: Request, routeContext: RouteContext) {
  const context = await trainingRequestContext()
  if (!context.ok) return context.response
  const id = await routineId(routeContext)
  if (!id) return trainingJson({ error: 'invalid_routine_id' }, 400)
  try {
    const result = await readManualReferenceRoutine(context.supabase, id)
    return result === null
      ? trainingJson({ error: 'manual_routine_not_found' }, 404)
      : trainingJson(result)
  } catch (error) {
    return routineError(error)
  }
}

export async function PATCH(request: Request, routeContext: RouteContext) {
  const context = await trainingRequestContext(true)
  if (!context.ok) return context.response
  const id = await routineId(routeContext)
  if (!id) return trainingJson({ error: 'invalid_routine_id' }, 400)
  const body = await parseManualReferenceRoutineBody(request, UpdateManualReferenceRoutineV1Schema)
  if (!body.ok) return body.response
  try {
    return trainingJson(await updateManualReferenceRoutine(context.supabase, id, body.data))
  } catch (error) {
    return routineError(error)
  }
}

export async function DELETE(request: Request, routeContext: RouteContext) {
  const context = await trainingRequestContext(true)
  if (!context.ok) return context.response
  const id = await routineId(routeContext)
  if (!id) return trainingJson({ error: 'invalid_routine_id' }, 400)
  const body = await parseManualReferenceRoutineBody(request, ArchiveManualReferenceRoutineV1Schema)
  if (!body.ok) return body.response
  try {
    return trainingJson(await archiveManualReferenceRoutine(context.supabase, id, body.data))
  } catch (error) {
    return routineError(error)
  }
}
