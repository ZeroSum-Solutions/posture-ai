import { z } from 'zod'
import {
  CreateManualReferenceRoutineV1Schema,
  ManualReferenceRoutineListPageV1Schema,
} from '@/lib/training/contracts/manual-reference-routine'
import {
  ManualReferenceRoutineError,
  createManualReferenceRoutine,
  listManualReferenceRoutines,
} from '@/lib/training/persistence/manual-reference-routine'
import { trainingRequestContext } from '@/lib/training/persistence/request-context'
import { parseManualReferenceRoutineBody } from '@/lib/training/persistence/manual-reference-routine-http'
import { trainingJson } from '@/lib/training/persistence/session-http'

function routineError(error: unknown) {
  if (error instanceof z.ZodError) return trainingJson({ error: 'invalid_training_payload' }, 422)
  if (!(error instanceof ManualReferenceRoutineError)) return trainingJson({ error: 'manual_routine_unavailable' }, 503)
  if (error.code === 'manual_routine_forbidden') return trainingJson({ error: error.code }, 403)
  if (error.code === 'manual_routine_invalid_reference') return trainingJson({ error: error.code }, 422)
  if (error.code === 'manual_routine_request_conflict') return trainingJson({ error: error.code }, 409)
  if (error.code === 'manual_routine_invalid_cursor') return trainingJson({ error: 'invalid_training_query' }, 400)
  return trainingJson({ error: error.code }, 503)
}

export async function POST(request: Request) {
  const context = await trainingRequestContext(true)
  if (!context.ok) return context.response
  const body = await parseManualReferenceRoutineBody(request, CreateManualReferenceRoutineV1Schema)
  if (!body.ok) return body.response
  try {
    return trainingJson(await createManualReferenceRoutine(context.supabase, body.data), 201)
  } catch (error) {
    return routineError(error)
  }
}

export async function GET(request: Request) {
  const context = await trainingRequestContext()
  if (!context.ok) return context.response
  const query = new URL(request.url).searchParams
  if ([...query.keys()].some(key => !['subjectId', 'limit', 'cursor'].includes(key))
    || query.getAll('subjectId').length !== 1
    || query.getAll('limit').length > 1
    || query.getAll('cursor').length > 1) {
    return trainingJson({ error: 'invalid_training_query' }, 400)
  }
  const subjectId = z.string().uuid().safeParse(query.get('subjectId'))
  if (!subjectId.success) return trainingJson({ error: 'invalid_subject_id' }, 400)
  const rawLimit = query.get('limit')
  const page = ManualReferenceRoutineListPageV1Schema.safeParse({
    ...(rawLimit === null ? {} : { limit: /^[1-9][0-9]{0,2}$/.test(rawLimit) ? Number(rawLimit) : Number.NaN }),
    ...(query.has('cursor') ? { cursor: query.get('cursor') } : {}),
  })
  if (!page.success) return trainingJson({ error: 'invalid_training_query' }, 400)
  try {
    return trainingJson(await listManualReferenceRoutines(context.supabase, subjectId.data, page.data))
  } catch (error) {
    return routineError(error)
  }
}
