import { createHash } from 'node:crypto'
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { enforceRateLimitStrict } from '@/lib/rate-limit'

/** The public prototype has a shared spend ceiling as well as a per-address limit. */
export async function guardDemoGeneration(req: Request): Promise<Response | null> {
  const headers = { 'Cache-Control': 'no-store' }
  const deny = (error: string, status: number) => Response.json({ error }, { status, headers })
  if (req.headers.get('origin') !== new URL(req.url).origin) {
    return deny('Open the workout builder to create a workout.', 403)
  }
  if (!req.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    return deny('Send a JSON workout request.', 415)
  }
  if (Number(req.headers.get('content-length') ?? 0) > 32_768) {
    return deny('Workout request is too large.', 413)
  }
  try {
    const service = createSupabaseServiceClient()
    // Vercel overwrites this header at its edge. Local development shares one bucket.
    const ip = process.env.VERCEL === '1'
      ? req.headers.get('x-vercel-forwarded-for') ?? 'unknown'
      : 'local'
    const userId = createHash('sha256').update(ip).digest('hex')
    const allowed = await enforceRateLimitStrict(service, {
      route: 'demo_ai', userId, limit: 12, windowSeconds: 3600,
    })
    if (!allowed) return deny('AI request limit reached. You can still build a scan-based workout.', 429)
    const withinBudget = await enforceRateLimitStrict(service, {
      route: 'demo_ai_budget', userId: 'shared', limit: 150, windowSeconds: 86400,
    })
    if (!withinBudget) return deny('AI is at its daily limit. You can still build a scan-based workout.', 429)
  } catch {
    return deny('AI is temporarily unavailable. You can still build a scan-based workout.', 503)
  }
  return null
}
