/**
 * Shapes the public share-link payload. resolve_workout_token() returns internal
 * ids (session/practitioner/client/run) the SERVER needs for audit + rating
 * writes — but those must never reach the client. redactSessionForPublic keeps
 * only the client-safe projection, so a leaked link reveals a first name + the
 * (identifier-free) workout content and nothing that enables an IDOR.
 */
import type { SessionSnapshot } from './generateWorkoutSession'

export interface ResolvedSession {
  workout_session_id: string
  practitioner_id: string
  client_id: string
  session_run_id: string | null
  program_snapshot: SessionSnapshot
  estimated_duration_sec: number | null
  client_first_name: string | null
  expires_at: string | null
}

export interface PublicSession {
  snapshot: SessionSnapshot
  estimatedDurationSec: number | null
  clientFirstName: string | null
  expiresAt: string | null
}

export function redactSessionForPublic(r: ResolvedSession): PublicSession {
  return {
    snapshot: r.program_snapshot,
    estimatedDurationSec: r.estimated_duration_sec,
    clientFirstName: r.client_first_name,
    expiresAt: r.expires_at,
  }
}
