import { z } from 'zod'
import { enforceRateLimitStrict } from '@/lib/rate-limit'
import { createSupabaseServerClient, createSupabaseServiceClient } from '@/lib/supabase/server'
import { trainingJson } from '@/lib/training/persistence/session-http'

const inputSchema = z.object({ requestId: z.string().uuid() }).strict()
const receiptSchema = z.object({
  schemaVersion: z.literal('training-subject-erasure.v1'),
  status: z.enum(['erased', 'already_erased']),
  subjectId: z.string().uuid(),
  requestId: z.string().uuid(),
}).strict()

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient()
  const { data: { user }, error: userError } = await supabase.auth.getUser()
  if (userError || !user) return trainingJson({ error: 'unauthorized' }, 401)

  const { data: assurance, error: assuranceError } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
  if (assuranceError) return trainingJson({ error: 'assurance_unavailable' }, 503)
  if (assurance?.currentLevel !== 'aal2') return trainingJson({ error: 'mfa_required' }, 403)

  const body = inputSchema.safeParse(await request.json().catch(() => null))
  if (!body.success) return trainingJson({ error: 'invalid_subject_erasure_request' }, 422)
  const allowed = await enforceRateLimitStrict(createSupabaseServiceClient(), {
    route: 'training_subject_erasure', userId: user.id, limit: 3, windowSeconds: 3_600,
  })
  if (!allowed) return trainingJson({ error: 'training_subject_erasure_rate_limited' }, 429)

  const { data, error } = await supabase.rpc('erase_training_subject_transactional', {
    p_request_id: body.data.requestId,
  })
  if (error) {
    if (error.code === '42501') return trainingJson({ error: 'training_subject_erasure_forbidden' }, 403)
    if (error.code === 'P0001') return trainingJson({ error: 'training_subject_not_found' }, 404)
    return trainingJson({ error: 'training_subject_erasure_unavailable' }, 503)
  }
  const receipt = receiptSchema.safeParse(data)
  if (!receipt.success || receipt.data.requestId !== body.data.requestId) {
    return trainingJson({ error: 'training_subject_erasure_unavailable' }, 503)
  }
  return trainingJson(receipt.data)
}
