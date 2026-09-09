import { z } from 'zod'
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { CreateExerciseSwapProposalsInputV1Schema } from '@/lib/training/contracts/exercise-swap'
import {
  ExerciseSwapError,
  createStoredExerciseSwapProposals,
  createSupabaseExerciseSwapDependencies,
} from '@/lib/training/persistence/exercise-swaps'
import { trainingRequestContext } from '@/lib/training/persistence/request-context'
import { parseTrainingBody, trainingJson } from '@/lib/training/persistence/session-http'

function swapError(error: unknown) {
  if (error instanceof z.ZodError) return trainingJson({ error: 'invalid_training_payload' }, 422)
  if (!(error instanceof ExerciseSwapError)) return trainingJson({ error: 'exercise_swap_unavailable' }, 503)
  if (error.code === 'exercise_swap_source_stale') {
    return trainingJson({ error: error.code, action: 'refresh_exercise_swaps' }, 409)
  }
  if (error.code === 'exercise_swap_forbidden') return trainingJson({ error: error.code }, 403)
  return trainingJson({ error: error.code }, 503)
}

export async function POST(request: Request) {
  const context = await trainingRequestContext(true)
  if (!context.ok) return context.response
  const body = await parseTrainingBody(request, CreateExerciseSwapProposalsInputV1Schema)
  if (!body.ok) return body.response
  try {
    return trainingJson(await createStoredExerciseSwapProposals(
      body.data,
      context.actor,
      createSupabaseExerciseSwapDependencies(context.supabase, createSupabaseServiceClient()),
    ))
  } catch (error) {
    return swapError(error)
  }
}
