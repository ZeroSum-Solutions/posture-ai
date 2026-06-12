import type { SupabaseClient } from '@supabase/supabase-js'
import { logEvent } from './log'

// Fixed-window rate limit backed by Postgres (see migrations/20260612030000).
// Fails OPEN on infrastructure errors: availability beats strictness for a
// screening tool, and the failure is logged for follow-up.
export async function enforceRateLimit(
  service: SupabaseClient,
  opts: { route: string; userId: string; limit: number; windowSeconds: number }
): Promise<boolean> {
  const key = `${opts.route}:${opts.userId}`
  const { data, error } = await service.rpc('check_rate_limit', {
    p_key: key,
    p_limit: opts.limit,
    p_window_seconds: opts.windowSeconds,
  })
  if (error) {
    logEvent({ route: opts.route, outcome: 'server_error', status: 0, detail: `rate-limit rpc failed: ${error.message}` })
    return true
  }
  return data === true
}
