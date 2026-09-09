import { z } from 'zod'
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { AcceptConditioningRevisionProposalInputV1Schema } from '@/lib/training/contracts/conditioning-revision'
import {
  ConditioningRevisionError,
  acceptStoredConditioningRevisionProposal,
  createSupabaseConditioningRevisionDependencies,
} from '@/lib/training/persistence/conditioning-revisions'
import { trainingRequestContext } from '@/lib/training/persistence/request-context'
import { parseTrainingBody, trainingJson } from '@/lib/training/persistence/session-http'

export async function POST(request: Request, { params }: { params: Promise<{ proposalId: string }> }) {
  const context = await trainingRequestContext(true)
  if (!context.ok) return context.response
  const body = await parseTrainingBody(request, AcceptConditioningRevisionProposalInputV1Schema)
  if (!body.ok) return body.response
  const { proposalId } = await params
  try {
    return trainingJson(await acceptStoredConditioningRevisionProposal(
      proposalId,
      body.data,
      createSupabaseConditioningRevisionDependencies(context.supabase, createSupabaseServiceClient()),
    ))
  } catch (error) {
    if (error instanceof z.ZodError) return trainingJson({ error: 'invalid_training_payload' }, 422)
    if (error instanceof ConditioningRevisionError) {
      if (error.code === 'conditioning_revision_request_id_conflict') {
        return trainingJson({ error: error.code, action: 'retry_with_new_request' }, 409)
      }
      if (error.code === 'conditioning_revision_source_stale') {
        return trainingJson({ error: error.code, action: 'refresh_conditioning_revision' }, 409)
      }
      if (error.code === 'conditioning_revision_forbidden') return trainingJson({ error: error.code }, 403)
    }
    return trainingJson({ error: 'conditioning_revision_unavailable' }, 503)
  }
}
