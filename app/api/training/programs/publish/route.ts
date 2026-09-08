import { isTrainingConflictCode } from '@/lib/training/persistence/conflict'
import { z } from 'zod'
import { TrainingStableIdV1Schema } from '@/lib/training/contracts/program'
import { trainingRequestContext } from '@/lib/training/persistence/request-context'
import { parseTrainingBody, trainingJson } from '@/lib/training/persistence/session-http'

const inputSchema = z.object({ draftId: z.string().uuid() }).strict()

export async function POST(request: Request) {
  const context = await trainingRequestContext(true)
  if (!context.ok) return context.response
  const body = await parseTrainingBody(request, inputSchema)
  if (!body.ok) return body.response
  const { data, error } = await context.supabase.rpc('publish_training_program_draft', { p_draft_id: body.data.draftId })
  if (error) {
    if (isTrainingConflictCode(error.code)) return trainingJson({ error: 'training_draft_stale', action: 'rebuild_draft' }, 409)
    if (error.code === 'P0001' || error.code === '42501') return trainingJson({ error: 'training_publication_unavailable' }, 403)
    return trainingJson({ error: 'training_publication_unavailable' }, 503)
  }
  const assignment = TrainingStableIdV1Schema.safeParse(data)
  if (!assignment.success) return trainingJson({ error: 'training_publication_unavailable' }, 503)
  return trainingJson({ schemaVersion: 'training-publication-ack.v1', assignmentId: assignment.data })
}
