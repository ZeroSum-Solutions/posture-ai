import { describe, test, expect } from 'vitest'
import { redactSessionForPublic, type ResolvedSession } from './tokenProjection'
import type { SessionSnapshot } from './generateWorkoutSession'

const snapshot = { version: 1, week: 1, capability: 'standard', priorities: [], items: [], estimatedDurationSec: 720, disclaimer: 'Screening only.' } as SessionSnapshot

const resolved: ResolvedSession = {
  workout_session_id: 'ws-secret',
  practitioner_id: 'prac-secret',
  client_id: 'client-secret',
  session_run_id: 'run-secret',
  program_snapshot: snapshot,
  estimated_duration_sec: 720,
  client_first_name: 'Sam',
  expires_at: '2026-07-09T00:00:00.000Z',
}

describe('redactSessionForPublic', () => {
  test('exposes only the client-safe fields', () => {
    expect(redactSessionForPublic(resolved)).toEqual({
      snapshot,
      estimatedDurationSec: 720,
      clientFirstName: 'Sam',
      expiresAt: '2026-07-09T00:00:00.000Z',
    })
  })

  test('never leaks internal identifiers (session/practitioner/client/run ids)', () => {
    const pub = redactSessionForPublic(resolved) as unknown as Record<string, unknown>
    const leaked = ['ws-secret', 'prac-secret', 'client-secret', 'run-secret']
    const serialized = JSON.stringify(pub)
    for (const id of leaked) expect(serialized).not.toContain(id)
    for (const k of ['workout_session_id', 'practitioner_id', 'client_id', 'session_run_id']) {
      expect(k in pub).toBe(false)
    }
  })
})
