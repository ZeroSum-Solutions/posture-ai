import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { PROGRAM_LIVE_CATALOG_REGISTRY } from '@/lib/training/catalog/liveRegistry'
import {
  ProgramBuildError,
  createSupabaseProgramBuildDependencies,
  readStoredProgramBuildProjection,
} from '@/lib/training/persistence/program-build'
import { trainingRequestContext } from '@/lib/training/persistence/request-context'
import { trainingJson } from '@/lib/training/persistence/session-http'

export async function GET(_request: Request, { params }: { params: Promise<{ buildId: string }> }) {
  const context = await trainingRequestContext()
  if (!context.ok) return context.response
  const { buildId } = await params
  try {
    const result = await readStoredProgramBuildProjection(
      buildId,
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
      if (error.code === 'program_build_forbidden') return trainingJson({ error: error.code }, 403)
      if (error.code === 'program_build_unavailable') return trainingJson({ error: error.code }, 404)
    }
    return trainingJson({ error: 'training_build_unavailable' }, 503)
  }
}
