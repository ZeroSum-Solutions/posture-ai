import { z } from 'zod'
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { AcceptProgressionProposalInputV1Schema } from '@/lib/training/contracts/progression'
import {
  ProgressionProposalError,
  acceptStoredProgressionProposal,
  createSupabaseProgressionProposalDependencies,
} from '@/lib/training/persistence/progression-proposals'
import { trainingRequestContext } from '@/lib/training/persistence/request-context'
import { parseTrainingBody, trainingJson } from '@/lib/training/persistence/session-http'

function acceptanceError(error: unknown) {
  if (error instanceof z.ZodError) return trainingJson({ error: 'invalid_training_payload' }, 422)
  if (!(error instanceof ProgressionProposalError)) {
    return trainingJson({ error: 'progression_acceptance_unavailable' }, 503)
  }
  if (error.code === 'progression_source_stale' || error.code === 'progression_proposal_conflict') {
    return trainingJson({ error: error.code, action: 'refresh_progression' }, 409)
  }
  if (error.code === 'progression_profile_stale') {
    return trainingJson({ error: error.code, action: 'rebuild_program' }, 409)
  }
  if (error.code === 'progression_proposal_forbidden') return trainingJson({ error: error.code }, 403)
  return trainingJson({ error: error.code }, 503)
}

export async function POST(request: Request, { params }: { params: Promise<{ proposalId: string }> }) {
  const context = await trainingRequestContext(true)
  if (!context.ok) return context.response
  const body = await parseTrainingBody(request, AcceptProgressionProposalInputV1Schema)
  if (!body.ok) return body.response
  const { proposalId } = await params
  try {
    return trainingJson(await acceptStoredProgressionProposal(
      proposalId,
      body.data,
      createSupabaseProgressionProposalDependencies(context.supabase, createSupabaseServiceClient()),
    ))
  } catch (error) {
    return acceptanceError(error)
  }
}
