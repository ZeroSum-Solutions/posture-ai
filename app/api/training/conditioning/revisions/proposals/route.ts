import { z } from 'zod'
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { CreateConditioningRevisionProposalInputV1Schema } from '@/lib/training/contracts/conditioning-revision'
import {
  ConditioningRevisionError,
  createStoredConditioningRevisionProposal,
  createSupabaseConditioningRevisionDependencies,
} from '@/lib/training/persistence/conditioning-revisions'
import { trainingRequestContext } from '@/lib/training/persistence/request-context'
import { parseTrainingBody, trainingJson } from '@/lib/training/persistence/session-http'

export async function POST(request: Request) {
  const context = await trainingRequestContext(true)
  if (!context.ok) return context.response
  const body = await parseTrainingBody(request, CreateConditioningRevisionProposalInputV1Schema)
  if (!body.ok) return body.response
  try {
    return trainingJson(await createStoredConditioningRevisionProposal(
      body.data,
      context.actor,
      createSupabaseConditioningRevisionDependencies(context.supabase, createSupabaseServiceClient()),
    ))
  } catch (error) {
    if (error instanceof z.ZodError) return trainingJson({ error: 'invalid_training_payload' }, 422)
    if (error instanceof ConditioningRevisionError) {
      if (error.code === 'conditioning_revision_forbidden') return trainingJson({ error: error.code }, 403)
      if (error.code === 'conditioning_revision_source_stale') {
        return trainingJson({ error: error.code, action: 'refresh_conditioning_revision' }, 409)
      }
    }
    return trainingJson({ error: 'conditioning_revision_unavailable' }, 503)
  }
}
