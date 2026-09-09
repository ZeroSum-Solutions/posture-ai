import { z } from 'zod'
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { PROGRAM_LIVE_CATALOG_REGISTRY } from '@/lib/training/catalog/liveRegistry'
import {
  CreateProgramBuildInputV1Schema,
  ProgramBuildError,
  createStoredProgramBuild,
  createSupabaseProgramBuildDependencies,
} from '@/lib/training/persistence/program-build'
import { trainingRequestContext } from '@/lib/training/persistence/request-context'
import { parseTrainingBody, trainingJson } from '@/lib/training/persistence/session-http'

function buildError(error: unknown) {
  if (error instanceof z.ZodError) return trainingJson({ error: 'invalid_training_payload' }, 422)
  if (!(error instanceof ProgramBuildError)) return trainingJson({ error: 'training_build_unavailable' }, 503)
  if (error.code === 'program_build_stale') return trainingJson({ error: error.code, action: 'reload_profile' }, 409)
  if (error.code === 'program_build_forbidden') return trainingJson({ error: error.code }, 403)
  if (error.code === 'program_build_unavailable') return trainingJson({ error: error.code }, 422)
  return trainingJson({ error: 'training_build_unavailable' }, 503)
}

export async function POST(request: Request) {
  const context = await trainingRequestContext(true)
  if (!context.ok) return context.response
  const body = await parseTrainingBody(request, CreateProgramBuildInputV1Schema)
  if (!body.ok) return body.response
  try {
    const result = await createStoredProgramBuild(
      body.data,
      context.actor,
      createSupabaseProgramBuildDependencies(
        context.supabase,
        createSupabaseServiceClient(),
        PROGRAM_LIVE_CATALOG_REGISTRY,
      ),
    )
    return trainingJson(result)
  } catch (error) {
    return buildError(error)
  }
}
