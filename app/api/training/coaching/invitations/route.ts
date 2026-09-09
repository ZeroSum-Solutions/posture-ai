import { enforceRateLimitStrict } from '@/lib/rate-limit'
import { resolveSiteOrigin } from '@/lib/site-origin'
import { createSupabaseServerClient, createSupabaseServiceClient } from '@/lib/supabase/server'
import { requireTrainingServerActor } from '@/lib/training/access/server-actor'
import {
  CoachAthleteInvitationPrepareInputSchema,
  InvitationPrepareError,
  createSupabaseInvitationPrepareDependencies,
  prepareCoachAthleteInvitation,
} from '@/lib/training/invitations/prepare'
import { trainingJson } from '@/lib/training/persistence/session-http'

function databaseErrorCode(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error
    && typeof error.code === 'string' ? error.code : null
}

function invitationError(error: unknown) {
  if (error instanceof InvitationPrepareError) {
    if (error.code === 'invalid_invitation_request') {
      return trainingJson({ error: error.code }, 422)
    }
    return trainingJson({ error: error.code }, 503)
  }
  const code = databaseErrorCode(error)
  if (code === 'PT409' || code === '23505') {
    return trainingJson({ error: 'invitation_request_conflict', action: 'refresh_client_setup' }, 409)
  }
  if (code === '22023') return trainingJson({ error: 'invalid_invitation_request' }, 422)
  if (code === '42501' || code === 'P0001') {
    return trainingJson({ error: 'invitation_prepare_forbidden' }, 403)
  }
  return trainingJson({ error: 'invitation_prepare_unavailable' }, 503)
}

export async function POST(request: Request) {
  const rawBody = await request.json().catch(() => null)
  const body = CoachAthleteInvitationPrepareInputSchema.safeParse(rawBody)
  if (!body.success) return trainingJson({ error: 'invalid_invitation_request' }, 422)

  const supabase = await createSupabaseServerClient()
  const actor = await requireTrainingServerActor(supabase)
  if (!actor.ok) return trainingJson({ error: actor.code }, actor.status)
  if (actor.actorKind !== 'practitioner') {
    return trainingJson({ error: 'practitioner_required' }, 403)
  }

  const service = createSupabaseServiceClient()
  const allowed = await enforceRateLimitStrict(service, {
    route: 'training_coach_invitation_prepare',
    userId: actor.userId,
    limit: 20,
    windowSeconds: 3_600,
  })
  if (!allowed) return trainingJson({ error: 'invitation_prepare_rate_limited' }, 429)

  try {
    const prepared = await prepareCoachAthleteInvitation(
      body.data,
      actor.userId,
      resolveSiteOrigin(),
      createSupabaseInvitationPrepareDependencies(supabase, service),
    )
    return trainingJson(prepared, 201)
  } catch (error) {
    return invitationError(error)
  }
}
