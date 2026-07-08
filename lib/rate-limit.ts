import type { SupabaseClient } from '@supabase/supabase-js'
import { logEvent } from './log'

type RateLimitOpts = { route: string; userId: string; limit: number; windowSeconds: number }

// The e2e suite (serial, one shared practitioner, production-server speed)
// legitimately exceeds the per-user limits, so scale them under the e2e-only
// server gate (never set in production) instead of disabling enforcement —
// the RPC and fail-open paths stay exercised.
function effectiveLimit(limit: number): number {
  return process.env.POSTURE_TEST_MODE_ENABLED === '1' ? limit * 50 : limit
}

function rateLimitRpcArgs(opts: RateLimitOpts) {
  const key = `${opts.route}:${opts.userId}`
  return {
    p_key: key,
    p_limit: effectiveLimit(opts.limit),
    p_window_seconds: opts.windowSeconds,
  }
}

// Fixed-window rate limit backed by Postgres (see migrations/20260612030000).
// Fails OPEN on infrastructure errors: availability beats strictness for a
// screening tool, and the failure is logged for follow-up.
export async function enforceRateLimit(
  service: SupabaseClient,
  opts: RateLimitOpts
): Promise<boolean> {
  const { data, error } = await service.rpc('check_rate_limit', rateLimitRpcArgs(opts))
  if (error) {
    logEvent({ route: opts.route, outcome: 'server_error', status: 0, detail: `rate-limit rpc failed: ${error.message}` })
    return true
  }
  return data === true
}

export async function enforceRateLimitStrict(
  service: SupabaseClient,
  opts: RateLimitOpts
): Promise<boolean> {
  const { data, error } = await service.rpc('check_rate_limit', rateLimitRpcArgs(opts))
  if (error) {
    logEvent({ route: opts.route, outcome: 'server_error', status: 0, detail: `rate-limit rpc failed (strict, denying): ${error.message}` })
    return false
  }
  return data === true
}
