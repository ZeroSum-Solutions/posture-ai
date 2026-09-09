import { z } from 'zod'
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { AcceptConditioningProgressionProposalInputV1Schema } from '@/lib/training/contracts/conditioning-progression'
import {
  ConditioningProgressionError,
  acceptStoredConditioningProgressionProposal,
  createSupabaseConditioningProgressionDependencies,
} from '@/lib/training/persistence/conditioning-progression'
import { trainingRequestContext } from '@/lib/training/persistence/request-context'
import { parseTrainingBody, trainingJson } from '@/lib/training/persistence/session-http'

function acceptanceError(error: unknown) {
  if (error instanceof z.ZodError) return trainingJson({ error: 'invalid_training_payload' }, 422)
  if (!(error instanceof ConditioningProgressionError)) {
    return trainingJson({ error: 'conditioning_progression_unavailable' }, 503)
  }
  if (error.code === 'conditioning_progression_source_stale') {
    return trainingJson({ error: error.code, action: 'refresh_conditioning_progression' }, 409)
  }
  if (error.code === 'conditioning_progression_forbidden') {
    return trainingJson({ error: error.code }, 403)
  }
  return trainingJson({ error: error.code }, 503)
}

export async function POST(request: Request, { params }: { params: Promise<{ proposalId: string }> }) {
  const context = await trainingRequestContext(true)
  if (!context.ok) return context.response
  const body = await parseTrainingBody(request, AcceptConditioningProgressionProposalInputV1Schema)
  if (!body.ok) return body.response
  const { proposalId } = await params
  try {
    return trainingJson(await acceptStoredConditioningProgressionProposal(
      proposalId,
      body.data,
      createSupabaseConditioningProgressionDependencies(
        context.supabase,
        createSupabaseServiceClient(),
      ),
    ))
  } catch (error) {
    return acceptanceError(error)
  }
}
