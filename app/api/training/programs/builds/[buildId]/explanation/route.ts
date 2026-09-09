import { enforceRateLimitStrict } from '@/lib/rate-limit'
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { PROGRAM_LIVE_CATALOG_REGISTRY } from '@/lib/training/catalog/liveRegistry'
import {
  buildTrainingBuildFactCatalog,
  renderTrainingBuildExplanation,
  toTrainingBuildExplanationProviderFacts,
} from '@/lib/training/explanation/facts'
import {
  requestTrainingExplanationSelection,
  trainingExplanationProviderConfiguration,
} from '@/lib/training/explanation/provider.server'
import {
  ProgramBuildError,
  createSupabaseProgramBuildDependencies,
  readStoredProgramBuildProjection,
} from '@/lib/training/persistence/program-build'
import { trainingRequestContext } from '@/lib/training/persistence/request-context'
import { trainingJson } from '@/lib/training/persistence/session-http'

export async function POST(_request: Request, { params }: { params: Promise<{ buildId: string }> }) {
  const context = await trainingRequestContext()
  if (!context.ok) return context.response
  const { buildId } = await params

  try {
    const service = createSupabaseServiceClient()
    const dependencies = createSupabaseProgramBuildDependencies(
      context.supabase,
      service,
      PROGRAM_LIVE_CATALOG_REGISTRY,
    )
    const projection = await readStoredProgramBuildProjection(buildId, context.actor, dependencies)
    let catalog = buildTrainingBuildFactCatalog({ projection })
    const configuration = trainingExplanationProviderConfiguration()
    let providerSelection: unknown | undefined
    let providerAttempted = false

    if (configuration) {
      try {
        const allowed = await enforceRateLimitStrict(service, {
          route: 'training_build_explanation_provider',
          userId: context.actor.userId,
          limit: 20,
          windowSeconds: 60,
        })
        if (allowed) {
          providerAttempted = true
          providerSelection = await requestTrainingExplanationSelection(
            toTrainingBuildExplanationProviderFacts(catalog).facts,
            configuration,
          )
        }
      } catch {
        providerSelection = undefined
      }
    }

    if (providerAttempted) {
      const currentProjection = await readStoredProgramBuildProjection(buildId, context.actor, dependencies)
      catalog = buildTrainingBuildFactCatalog({ projection: currentProjection })
    }

    return trainingJson(renderTrainingBuildExplanation({ catalog, providerSelection }))
  } catch (error) {
    if (error instanceof ProgramBuildError) {
      if (error.code === 'program_build_stale') {
        return trainingJson({ error: error.code, action: 'rebuild' }, 409)
      }
      if (error.code === 'program_build_forbidden') return trainingJson({ error: error.code }, 403)
      if (error.code === 'program_build_unavailable') return trainingJson({ error: error.code }, 404)
    }
    return trainingJson({ error: 'training_build_explanation_unavailable' }, 503)
  }
}
