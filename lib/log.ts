import { createHash } from 'node:crypto'

// Structured JSON-line logging for API routes — queryable in Vercel logs.
// Never log raw user ids or request bodies; user identity is a short hash.

export function hashUser(userId: string): string {
  return createHash('sha256').update(userId).digest('hex').slice(0, 12)
}

interface LogEvent {
  route: string
  outcome: 'ok' | 'client_error' | 'server_error' | 'rate_limited'
  status: number
  durationMs?: number
  userHash?: string
  assessmentId?: string
  detail?: string
}

export function logEvent(event: LogEvent): void {
  console.log(JSON.stringify({ ts: new Date().toISOString(), level: event.outcome === 'server_error' ? 'error' : 'info', ...event }))
}
