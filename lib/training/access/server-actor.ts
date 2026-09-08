import type { createSupabaseServerClient } from '@/lib/supabase/server'

type SupabaseServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>

type ApplicationActorRow = {
  actor_kind: 'athlete' | 'practitioner' | 'ambiguous'
  subject_id: string | null
  access_status: string
  role: string | null
  session_is_current: boolean
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export type TrainingServerActor =
  | {
      ok: true
      userId: string
      actorKind: 'athlete' | 'practitioner'
      subjectId: string | null
    }
  | {
      ok: false
      status: 401 | 403 | 503
      code: string
    }

/**
 * Resolves the current authenticated training actor without accepting any actor
 * identifier from the request. Database RPCs still enforce subject ownership,
 * relationship permission, admission, AAL2, and session cutoff per operation.
 */
export async function requireTrainingServerActor(
  supabase: SupabaseServerClient,
): Promise<TrainingServerActor> {
  const { data: { user }, error: userError } = await supabase.auth.getUser()
  if (userError || !user) return { ok: false, status: 401, code: 'unauthorized' }

  const { data: assurance, error: assuranceError } =
    await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
  if (assuranceError) return { ok: false, status: 503, code: 'assurance_unavailable' }
  if (assurance?.currentLevel !== 'aal2') {
    return { ok: false, status: 403, code: 'mfa_required' }
  }

  const { data, error } = await supabase.rpc('current_application_actor').maybeSingle()
  if (error) return { ok: false, status: 503, code: 'actor_unavailable' }
  const actor = data as ApplicationActorRow | null
  if (
    !actor
    || (actor.actor_kind !== 'athlete' && actor.actor_kind !== 'practitioner')
    || actor.access_status !== 'active'
    || actor.session_is_current !== true
    || (actor.actor_kind === 'practitioner' && actor.role !== 'practitioner')
    || (actor.actor_kind === 'athlete'
      && (typeof actor.subject_id !== 'string' || !UUID_PATTERN.test(actor.subject_id)))
    || (actor.actor_kind === 'practitioner' && actor.subject_id !== null)
  ) {
    return { ok: false, status: 403, code: 'training_actor_required' }
  }

  return {
    ok: true,
    userId: user.id,
    actorKind: actor.actor_kind,
    subjectId: actor.subject_id,
  }
}
