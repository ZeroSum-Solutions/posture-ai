import { PROGRAM_LIVE_CATALOG_REGISTRY } from '@/lib/training/catalog/liveRegistry'
import {
  ProgramOptionsError,
  ReadProgramOptionsInputV1Schema,
  createSupabaseProgramOptionsDependencies,
  readTrainingProgramOptions,
} from '@/lib/training/persistence/program-options'
import { trainingRequestContext } from '@/lib/training/persistence/request-context'
import { trainingJson } from '@/lib/training/persistence/session-http'

function parseSelectors(request: Request) {
  const search = new URL(request.url).searchParams
  const keys = [...search.keys()]
  if (keys.length !== 2
    || search.getAll('subjectId').length !== 1
    || search.getAll('profileRevision').length !== 1) return null
  const profileRevision = search.get('profileRevision') ?? ''
  if (!/^[1-9]\d*$/.test(profileRevision)) return null
  const parsed = ReadProgramOptionsInputV1Schema.safeParse({
    subjectId: search.get('subjectId'),
    profileRevision: Number(profileRevision),
  })
  return parsed.success ? parsed.data : null
}

function optionsError(error: unknown) {
  if (!(error instanceof ProgramOptionsError)) {
    return trainingJson({ error: 'program_options_unavailable' }, 503)
  }
  if (error.code === 'program_options_stale') {
    return trainingJson({ error: error.code, action: 'reload_profile' }, 409)
  }
  if (error.code === 'program_options_forbidden') {
    return trainingJson({ error: error.code }, 403)
  }
  return trainingJson({ error: error.code }, 503)
}

export async function GET(request: Request) {
  const input = parseSelectors(request)
  if (!input) return trainingJson({ error: 'invalid_program_options_query' }, 400)
  const context = await trainingRequestContext(false)
  if (!context.ok) return context.response
  try {
    const options = await readTrainingProgramOptions(
      input,
      context.actor,
      createSupabaseProgramOptionsDependencies(context.supabase, PROGRAM_LIVE_CATALOG_REGISTRY),
    )
    return trainingJson(options)
  } catch (error) {
    return optionsError(error)
  }
}
