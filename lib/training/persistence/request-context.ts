import { createSupabaseServerClient, createSupabaseServiceClient } from '@/lib/supabase/server'
import { enforceRateLimit } from '@/lib/rate-limit'
import { requireTrainingServerActor } from '../access/server-actor'
import { trainingJson } from './session-http'

export async function trainingRequestContext(write = false) {
  const supabase = await createSupabaseServerClient()
  const actor = await requireTrainingServerActor(supabase)
  if (!actor.ok) return { ok: false, response: trainingJson({ error: actor.code }, actor.status) } as const
  if (write) {
    const allowed = await enforceRateLimit(createSupabaseServiceClient(), {
      route: 'training_session_mutation', userId: actor.userId, limit: 120, windowSeconds: 60,
    })
    if (!allowed) return { ok: false, response: trainingJson({ error: 'training_rate_limited' }, 429) } as const
  }
  return { ok: true, supabase, actor } as const
}
