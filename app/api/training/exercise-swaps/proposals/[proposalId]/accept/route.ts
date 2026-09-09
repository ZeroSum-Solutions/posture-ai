import { z } from 'zod'
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { AcceptExerciseSwapProposalInputV1Schema } from '@/lib/training/contracts/exercise-swap'
import {
  ExerciseSwapError,
  acceptStoredExerciseSwapProposal,
  createSupabaseExerciseSwapDependencies,
} from '@/lib/training/persistence/exercise-swaps'
import { trainingRequestContext } from '@/lib/training/persistence/request-context'
import { parseTrainingBody, trainingJson } from '@/lib/training/persistence/session-http'

function acceptanceError(error: unknown) {
  if (error instanceof z.ZodError) return trainingJson({ error: 'invalid_training_payload' }, 422)
  if (!(error instanceof ExerciseSwapError)) return trainingJson({ error: 'exercise_swap_unavailable' }, 503)
  if (error.code === 'exercise_swap_source_stale') {
    return trainingJson({ error: error.code, action: 'refresh_exercise_swaps' }, 409)
  }
  if (error.code === 'exercise_swap_request_id_conflict') {
    return trainingJson({ error: error.code, action: 'retry_with_new_request' }, 409)
  }
  if (error.code === 'exercise_swap_selection_invalid') {
    return trainingJson({ error: error.code, action: 'choose_starting_target' }, 422)
  }
  if (error.code === 'exercise_swap_forbidden') return trainingJson({ error: error.code }, 403)
  return trainingJson({ error: error.code }, 503)
}

export async function POST(request: Request, { params }: { params: Promise<{ proposalId: string }> }) {
  const context = await trainingRequestContext(true)
  if (!context.ok) return context.response
  const body = await parseTrainingBody(request, AcceptExerciseSwapProposalInputV1Schema)
  if (!body.ok) return body.response
  const { proposalId } = await params
  try {
    return trainingJson(await acceptStoredExerciseSwapProposal(
      proposalId,
      body.data,
      createSupabaseExerciseSwapDependencies(context.supabase, createSupabaseServiceClient()),
    ))
  } catch (error) {
    return acceptanceError(error)
  }
}
