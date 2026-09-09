import { z } from 'zod'
import { TrainingStableIdV1Schema } from '@/lib/training/contracts/program'
import {
  TRAINING_PROGRAM_WORKSPACE_MAX_PAGE_SIZE,
  TRAINING_PROGRAM_WORKSPACE_PAGE_SIZE,
  TrainingProgramWorkspaceViewSchema,
} from '@/lib/training/contracts/program-workspace'
import { trainingRequestContext } from '@/lib/training/persistence/request-context'
import { loadProgramWorkspace, programWorkspaceDependencies } from '@/lib/training/persistence/program-workspace'
import { trainingJson } from '@/lib/training/persistence/session-http'

const querySchema = z.object({
  view: TrainingProgramWorkspaceViewSchema,
  limit: z.coerce.number().int().min(1).max(TRAINING_PROGRAM_WORKSPACE_MAX_PAGE_SIZE).default(TRAINING_PROGRAM_WORKSPACE_PAGE_SIZE),
  cursor: z.string().min(1).max(1_024).nullable().default(null),
}).strict()

export async function GET(request: Request, { params }: { params: Promise<{ assignmentId: string }> }) {
  const context = await trainingRequestContext()
  if (!context.ok) return context.response
  const { assignmentId } = await params
  if (!TrainingStableIdV1Schema.safeParse(assignmentId).success) return trainingJson({ error: 'invalid_program_id' }, 400)
  const search = new URL(request.url).searchParams
  const query = querySchema.safeParse(Object.fromEntries(search))
  if (!query.success || search.getAll('view').length !== 1 || search.getAll('limit').length > 1 || search.getAll('cursor').length > 1) {
    return trainingJson({ error: 'invalid_training_query' }, 400)
  }
  const result = await loadProgramWorkspace(programWorkspaceDependencies(context.supabase), { assignmentId, ...query.data })
  if (result.kind === 'found') return trainingJson(result.value)
  if (result.kind === 'not_found') return trainingJson({ error: 'training_program_not_found' }, 404)
  if (result.kind === 'stale_cursor') return trainingJson({ error: 'training_program_changed', action: 'reload_program' }, 409)
  return trainingJson({ error: 'training_program_workspace_unavailable' }, 503)
}
