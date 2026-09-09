import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { PROGRAM_LIVE_CATALOG_REGISTRY } from '@/lib/training/catalog/liveRegistry'
import {
  AcceptProgramBuildInputV1Schema,
  ProgramBuildError,
  acceptStoredProgramBuild,
  createSupabaseProgramBuildDependencies,
} from '@/lib/training/persistence/program-build'
import { trainingRequestContext } from '@/lib/training/persistence/request-context'
import { parseTrainingBody, trainingJson } from '@/lib/training/persistence/session-http'

export async function POST(request: Request, { params }: { params: Promise<{ buildId: string }> }) {
  const context = await trainingRequestContext(true)
  if (!context.ok) return context.response
  const body = await parseTrainingBody(request, AcceptProgramBuildInputV1Schema)
  if (!body.ok) return body.response
  const { buildId } = await params
  try {
    const result = await acceptStoredProgramBuild(
      buildId,
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
    if (error instanceof ProgramBuildError) {
      if (error.code === 'program_build_stale') return trainingJson({ error: error.code, action: 'rebuild' }, 409)
      if (error.code === 'program_build_selection_conflict') return trainingJson({ error: error.code }, 409)
      if (error.code === 'program_build_invalid_selection') return trainingJson({ error: error.code }, 422)
      if (error.code === 'program_build_forbidden') return trainingJson({ error: error.code }, 403)
      if (error.code === 'program_build_unavailable') return trainingJson({ error: error.code }, 404)
    }
    return trainingJson({ error: 'training_build_acceptance_unavailable' }, 503)
  }
}
