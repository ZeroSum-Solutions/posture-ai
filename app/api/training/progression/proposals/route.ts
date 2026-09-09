import { z } from 'zod'
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import {
  CreateProgressionProposalInputV1Schema,
} from '@/lib/training/contracts/progression'
import {
  ProgressionProposalError,
  createStoredProgressionProposal,
  createSupabaseProgressionProposalDependencies,
} from '@/lib/training/persistence/progression-proposals'
import { trainingRequestContext } from '@/lib/training/persistence/request-context'
import { parseTrainingBody, trainingJson } from '@/lib/training/persistence/session-http'

function proposalError(error: unknown) {
  if (error instanceof z.ZodError) return trainingJson({ error: 'invalid_training_payload' }, 422)
  if (!(error instanceof ProgressionProposalError)) {
    return trainingJson({ error: 'progression_proposal_unavailable' }, 503)
  }
  if (error.code === 'progression_profile_stale') {
    return trainingJson({ error: error.code, action: 'rebuild_program' }, 409)
  }
  if (error.code === 'progression_recovery_context_conflict'
    || error.code === 'progression_source_stale') {
    return trainingJson({ error: error.code, action: 'refresh_progression' }, 409)
  }
  if (error.code === 'progression_proposal_forbidden') return trainingJson({ error: error.code }, 403)
  return trainingJson({ error: error.code }, 503)
}

export async function POST(request: Request) {
  const context = await trainingRequestContext(true)
  if (!context.ok) return context.response
  const body = await parseTrainingBody(request, CreateProgressionProposalInputV1Schema)
  if (!body.ok) return body.response
  try {
    return trainingJson(await createStoredProgressionProposal(
      body.data,
      context.actor,
      createSupabaseProgressionProposalDependencies(context.supabase, createSupabaseServiceClient()),
    ))
  } catch (error) {
    return proposalError(error)
  }
}
