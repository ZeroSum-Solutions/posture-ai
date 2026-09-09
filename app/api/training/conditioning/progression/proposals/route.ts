import { z } from 'zod'
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { CreateConditioningProgressionProposalInputV1Schema } from '@/lib/training/contracts/conditioning-progression'
import {
  ConditioningProgressionError,
  createStoredConditioningProgressionProposal,
  createSupabaseConditioningProgressionDependencies,
} from '@/lib/training/persistence/conditioning-progression'
import { trainingRequestContext } from '@/lib/training/persistence/request-context'
import { parseTrainingBody, trainingJson } from '@/lib/training/persistence/session-http'

function proposalError(error: unknown) {
  if (error instanceof z.ZodError) return trainingJson({ error: 'invalid_training_payload' }, 422)
  if (!(error instanceof ConditioningProgressionError)) {
    return trainingJson({ error: 'conditioning_progression_unavailable' }, 503)
  }
  if (error.code === 'conditioning_progression_forbidden') {
    return trainingJson({ error: error.code }, 403)
  }
  return trainingJson({ error: error.code }, 503)
}

export async function POST(request: Request) {
  const context = await trainingRequestContext(true)
  if (!context.ok) return context.response
  const body = await parseTrainingBody(request, CreateConditioningProgressionProposalInputV1Schema)
  if (!body.ok) return body.response
  try {
    return trainingJson(await createStoredConditioningProgressionProposal(
      body.data,
      context.actor,
      createSupabaseConditioningProgressionDependencies(
        context.supabase,
        createSupabaseServiceClient(),
      ),
    ))
  } catch (error) {
    return proposalError(error)
  }
}
