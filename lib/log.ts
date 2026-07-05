import { createHash } from 'node:crypto'

// Structured JSON-line logging for API routes — queryable in Vercel logs.
// Never log raw user ids or request bodies; user identity is a short hash.

export function hashUser(userId: string): string {
  return createHash('sha256').update(userId).digest('hex').slice(0, 12)
}

// Hash the client IP for PII-minimized audit/rate-limit keys — no raw IPs at
// rest. Uses the RIGHTMOST x-forwarded-for hop: proxies append the connecting
// IP, so the rightmost value is the only hop a caller can't forge by sending a
// pre-populated header (leftmost would let an attacker rotate rate-limit keys
// at will). Callers should prefer x-real-ip when present. Returns null when the
// header is absent (e.g. local dev).
export function hashIp(forwardedFor: string | null): string | null {
  const ip = forwardedFor?.split(',').at(-1)?.trim()
  return ip ? createHash('sha256').update(ip).digest('hex') : null
}

interface LogEvent {
  route: string
  outcome: 'ok' | 'client_error' | 'server_error' | 'rate_limited' | 'red_flag_block'
  status: number
  durationMs?: number
  userHash?: string
  assessmentId?: string
  detail?: string
}

export function logEvent(event: LogEvent): void {
  console.log(JSON.stringify({ ts: new Date().toISOString(), level: event.outcome === 'server_error' ? 'error' : 'info', ...event }))
}
