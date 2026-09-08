import { afterEach, describe, expect, it, vi } from 'vitest'
import { createLoadQuantity } from '@/lib/training/quantity'
import {
  readTrainingSession,
  saveTrainingConditioning,
  saveTrainingSet,
  startTrainingSession,
  TrainingRevisionConflict,
} from './TrainingSessionPlayer.gateway'

const session = {
  id: 'session-1', subject_id: '10000000-0000-4000-8000-000000000001', assignment_id: 'assignment-1',
  session_kind: 'strength', revision: 2, state: 'in_progress', scheduled_local_date: '2026-09-14',
  athlete_timezone: 'UTC', stopped_for_symptoms: false, updated_at: '2026-09-14T00:00:00Z',
}
const projection = {
  schemaVersion: 'training-session-projection.v1', session, prescription: null,
  executionContext: { kind: 'live' },
  currentActuals: [], currentConditioningActual: null,
  exerciseDisplay: {}, conditioningDisplay: null,
}

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

afterEach(() => vi.unstubAllGlobals())

describe('training session player gateway', () => {
  it('starts from optimistic revision and reloads the immutable server prescription', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(response({ schemaVersion: 'training-start-ack.v1', prescription: { sessionId: 'session-1' } }))
      .mockResolvedValueOnce(response(projection))
    vi.stubGlobal('fetch', fetch)

    await expect(startTrainingSession('session-1', 1)).resolves.toMatchObject({ session: { revision: 2 } })
    expect(fetch).toHaveBeenNthCalledWith(1, '/api/training/sessions/session-1/start', expect.objectContaining({
      body: JSON.stringify({ expectedRevision: 1 }),
    }))
    expect(fetch).toHaveBeenNthCalledWith(2, '/api/training/sessions/session-1', { cache: 'no-store' })
  })

  it('saves exact entered load, reps and RIR without browser actor or context authority', async () => {
    const event = { sessionId: 'session-1', setId: 'set-1' }
    const fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => response({
      schemaVersion: 'training-mutation-ack.v1', requestId: JSON.parse(String(init?.body)).requestId,
      sessionId: 'session-1', revision: 3, state: 'in_progress', event,
    }))
    vi.stubGlobal('fetch', fetch)
    const actual = {
      quantity: createLoadQuantity({ value: '12.5', unit: 'lb' }), reps: 8, rir: 2 as const,
      side: 'bilateral' as const, symptomState: 'none' as const, occurredAt: '2026-09-14T12:00:00Z',
    }

    await saveTrainingSet({ sessionId: 'session-1', setId: 'set-1', expectedRevision: 2, actual })

    const body = JSON.parse(String(fetch.mock.calls[0][1]?.body)) as Record<string, unknown>
    expect(body).toMatchObject({ expectedRevision: 2, actual })
    expect(body).not.toHaveProperty('actor')
    expect(body).not.toHaveProperty('executionContext')
  })

  it('surfaces a 409 with the authorized current projection for explicit reload', async () => {
    const fetch = vi.fn(async () => response({ error: 'training_revision_conflict', current: projection }, 409))
    vi.stubGlobal('fetch', fetch)

    const promise = saveTrainingConditioning({
      sessionId: 'session-1', expectedRevision: 1,
      actual: { durationSeconds: 600, perceivedEffort: 'unknown', symptomState: 'none', occurredAt: '2026-09-14T12:00:00Z' },
    })
    await expect(promise).rejects.toBeInstanceOf(TrainingRevisionConflict)
  })

  it('rejects a projection for a different session', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response({ ...projection, session: { ...session, id: 'other-session' } })))
    await expect(readTrainingSession('session-1')).rejects.toThrow('response was invalid')
  })

  it('keeps business conflicts distinct from revision conflicts so unsaved editors remain mounted', async () => {
    const incomplete = vi.fn(async () => response({
      error: 'training_completion_incomplete', action: 'log_remaining_or_finish_with_omissions',
    }, 409))
    vi.stubGlobal('fetch', incomplete)
    await expect(saveTrainingConditioning({
      sessionId: 'session-1', expectedRevision: 2,
      actual: { durationSeconds: 600, perceivedEffort: 'unknown', symptomState: 'none', occurredAt: '2026-09-14T12:00:00Z' },
    })).rejects.toThrow(/finish with omissions/i)

    vi.stubGlobal('fetch', vi.fn(async () => response({
      error: 'training_request_id_conflict', action: 'retry_with_new_request',
    }, 409)))
    await expect(saveTrainingConditioning({
      sessionId: 'session-1', expectedRevision: 2,
      actual: { durationSeconds: 600, perceivedEffort: 'unknown', symptomState: 'none', occurredAt: '2026-09-14T12:00:00Z' },
    })).rejects.toThrow(/Try saving again/i)
  })
})
