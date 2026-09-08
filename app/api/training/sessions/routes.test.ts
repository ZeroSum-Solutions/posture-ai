import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextResponse } from 'next/server'
import { GET } from './[sessionId]/route'
import { POST as start } from './[sessionId]/start/route'
import { PUT } from './[sessionId]/sets/[setId]/route'
import { PUT as saveConditioning } from './[sessionId]/conditioning/route'
import { POST as complete } from './[sessionId]/complete/route'
import { POST as publish } from '../programs/publish/route'
import { createLoadQuantity } from '@/lib/training/quantity'
import { trainingRequestContext } from '@/lib/training/persistence/request-context'

vi.mock('@/lib/training/persistence/request-context', () => ({ trainingRequestContext: vi.fn() }))
const rpc = vi.fn()
const subjectId = '45000000-0000-4000-8000-000000000003'
const userId = '45000000-0000-4000-8000-000000000001'
const requestId = '46000000-0000-4000-8000-000000000004'
const params = { params: Promise.resolve({ sessionId: 'session-1', setId: 'set-1' }) }
const actual = {
  quantity: createLoadQuantity({ value: '2.5', unit: 'lb' }), reps: 8, rir: 'unknown',
  side: 'bilateral', symptomState: 'none', occurredAt: '2026-09-08T00:00:00Z',
}
const event = {
  schemaVersion: 'training-set-log-event.v1', eventId: 'event-1', eventType: 'set_actual_recorded', eventRevision: 1,
  replacesEventId: null, subjectId, sessionId: 'session-1', exerciseInstanceId: 'exercise-1', setId: 'set-1',
  setKind: 'working', workingSetOrdinal: 1, executionContext: { kind: 'live' }, equipmentId: 'db',
  loadBasis: 'dumbbell_single_implement', ...actual, actor: { kind: 'athlete', userId }, serverAt: '2026-09-08T00:00:01Z',
}
const ack = { schemaVersion: 'training-mutation-ack.v1', requestId, sessionId: 'session-1', revision: 3, state: 'in_progress', event }
const projection = {
  session: {
    id: 'session-1', subject_id: subjectId, assignment_id: 'assignment-1', session_kind: 'strength', revision: 1, state: 'scheduled',
    scheduled_local_date: '2026-09-08', athlete_timezone: 'UTC', stopped_for_symptoms: false, updated_at: '2026-09-08T00:00:00Z',
  }, executionContext: { kind: 'live' }, prescription: null, currentActuals: [], currentConditioningActual: null,
}
const request = (body: unknown) => new Request('http://localhost/api/training', { method: 'POST', body: JSON.stringify(body) })

beforeEach(() => {
  rpc.mockReset()
  vi.mocked(trainingRequestContext).mockReset().mockResolvedValue({
    ok: true, supabase: { rpc }, actor: { ok: true, actorKind: 'athlete', userId, subjectId },
  } as never)
})

describe('training program and online session routes', () => {
  it('does not touch persistence when the actor gate denies access', async () => {
    vi.mocked(trainingRequestContext).mockResolvedValueOnce({ ok: false, response: new NextResponse(null, { status: 403 }) })
    expect((await PUT(request({ requestId, expectedRevision: 2, actual }), params)).status).toBe(403)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('reads a single consistent RLS projection and disables response caching', async () => {
    rpc.mockResolvedValueOnce({ data: projection, error: null })
    const result = await GET(request({}), params)
    expect(result.status).toBe(200)
    expect(result.headers.get('Cache-Control')).toBe('private, no-store')
    expect(await result.json()).toMatchObject({ schemaVersion: 'training-session-projection.v1', session: { id: 'session-1' } })
    expect(rpc).toHaveBeenCalledWith('read_training_session_projection', { p_session_id: 'session-1' })
  })

  it('does not reinterpret a database read failure as an empty session', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: 'XX000' } })
    expect((await GET(request({}), params)).status).toBe(503)
  })

  it('hides missing and RLS-invisible sessions behind the same not-found response', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: null })
    expect((await GET(request({}), params)).status).toBe(404)
  })

  it('does not present an in-progress session with a missing immutable prescription', async () => {
    rpc.mockResolvedValueOnce({ data: { ...projection, session: { ...projection.session, state: 'in_progress' } }, error: null })
    expect((await GET(request({}), params)).status).toBe(503)
  })

  it('requires authoritative context even before a scheduled session starts', async () => {
    const withoutContext = { ...projection, executionContext: undefined }
    rpc.mockResolvedValueOnce({ data: withoutContext, error: null })
    expect((await GET(new Request('https://posture.test/api/training/sessions/session-1'), params)).status).toBe(503)
  })

  it('rejects browser actor/context/validity authority before calling a write RPC', async () => {
    for (const injected of [{ actor: { userId: 'other' } }, { executionContext: { kind: 'live' } }, { validity: 'qualifying' }]) {
      const result = await PUT(request({ requestId, expectedRevision: 2, actual: { ...actual, ...injected } }), params)
      expect(result.status).toBe(422)
    }
    expect(rpc).not.toHaveBeenCalled()
  })

  it('sends exact input values through the authenticated RPC and accepts a matching acknowledgement', async () => {
    rpc.mockResolvedValueOnce({ data: ack, error: null })
    const result = await PUT(request({ requestId, expectedRevision: 2, actual }), params)
    expect(result.status).toBe(200)
    expect(rpc).toHaveBeenCalledWith('write_training_set_log', {
      p_session_id: 'session-1', p_set_id: 'set-1', p_expected_revision: 2, p_request_id: requestId, p_actual: actual,
    })
    expect((await result.json()).event.quantity).toEqual({ entered: { value: '2.5', unit: 'lb' }, canonicalKg: '1.133980925' })
  })

  it.each(['PT409', '40001'])('returns a visible %s conflict with a fresh authorized projection instead of silently retrying the write', async (code) => {
    rpc.mockResolvedValueOnce({ data: null, error: { code } }).mockResolvedValueOnce({ data: projection, error: null })
    const result = await PUT(request({ requestId, expectedRevision: 2, actual }), params)
    expect(result.status).toBe(409)
    expect(await result.json()).toMatchObject({ error: 'training_revision_conflict', current: { session: { revision: 1 } } })
    expect(rpc).toHaveBeenCalledTimes(2)
  })

  it('reports unlogged completion without treating it as an overwrite or reloading editors', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: 'PT409', message: 'training session has unlogged sets' } })
    const result = await complete(request({ requestId, expectedRevision: 3, finishMode: 'complete' }), params)
    expect(result.status).toBe(409)
    expect(await result.json()).toEqual({ error: 'training_completion_incomplete', action: 'log_remaining_or_finish_with_omissions' })
    expect(rpc).toHaveBeenCalledTimes(1)
  })

  it('reports reused request content without replacing local editors', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: 'PT409', message: 'training request ID reused with different content' } })
    const result = await PUT(request({ requestId, expectedRevision: 2, actual }), params)
    expect(result.status).toBe(409)
    expect(await result.json()).toEqual({ error: 'training_request_id_conflict', action: 'retry_with_new_request' })
    expect(rpc).toHaveBeenCalledTimes(1)
  })

  it('never returns a cross-session acknowledgement as a successful save', async () => {
    rpc.mockResolvedValueOnce({ data: { ...ack, event: { ...event, sessionId: 'another-session' } }, error: null })
    expect((await PUT(request({ requestId, expectedRevision: 2, actual }), params)).status).toBe(503)
  })

  it('does not attribute an acknowledgement from a different actor to the current save', async () => {
    rpc.mockResolvedValueOnce({ data: { ...ack, event: { ...event, actor: { ...event.actor, userId: 'another-user' } } }, error: null })
    expect((await PUT(request({ requestId, expectedRevision: 2, actual }), params)).status).toBe(503)
  })

  it('rejects a false conversion and fractional reps', async () => {
    for (const invalid of [{ ...actual, reps: 8.5 }, { ...actual, quantity: { ...actual.quantity, canonicalKg: '2.5' } }]) {
      expect((await PUT(request({ requestId, expectedRevision: 2, actual: invalid }), params)).status).toBe(422)
    }
    expect(rpc).not.toHaveBeenCalled()
  })

  it('requires an explicit completion mode and keeps it separate from set entry', async () => {
    expect((await complete(request({ requestId, expectedRevision: 3 }), params)).status).toBe(422)
    rpc.mockResolvedValueOnce({ data: { ...ack, event: undefined, state: 'completed_with_omissions', missingSetCount: 2 }, error: null })
    const result = await complete(request({ requestId, expectedRevision: 3, finishMode: 'finish_with_omissions' }), params)
    expect(result.status).toBe(200)
    expect(rpc).toHaveBeenCalledWith('complete_training_session', {
      p_session_id: 'session-1', p_expected_revision: 3, p_request_id: requestId, p_finish_mode: 'finish_with_omissions',
    })
  })

  it('sends only session and optimistic revision on start, never caller prescription JSON', async () => {
    expect((await start(request({ expectedRevision: 1, prescription: {} }), params)).status).toBe(422)
    rpc.mockResolvedValueOnce({ data: null, error: { code: 'P0001' } })
    expect((await start(request({ expectedRevision: 1 }), params)).status).toBe(403)
    expect(rpc).toHaveBeenCalledWith('start_training_session', { p_session_id: 'session-1', p_expected_revision: 1 })
  })

  it('publishes only a server-owned draft ID', async () => {
    const draftId = '45000000-0000-4000-8000-000000000006'
    expect((await publish(request({ draftId, program: {} }))).status).toBe(422)
    rpc.mockResolvedValueOnce({ data: 'assignment-1', error: null })
    const result = await publish(request({ draftId }))
    expect(result.status).toBe(200)
    expect(await result.json()).toMatchObject({ assignmentId: 'assignment-1' })
    expect(rpc).toHaveBeenCalledWith('publish_training_program_draft', { p_draft_id: draftId })
  })

  it('requires a rebuilt draft after profile changes instead of publishing stale targets', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: '40001' } })
    const result = await publish(request({ draftId: '45000000-0000-4000-8000-000000000006' }))
    expect(result.status).toBe(409)
    expect(await result.json()).toEqual({ error: 'training_draft_stale', action: 'rebuild_draft' })
  })
})


describe('conditioning session routes', () => {
  const conditioningActual = { durationSeconds: 540, perceivedEffort: 'unknown', symptomState: 'none', occurredAt: '2026-09-08T00:00:00Z' }
  const conditioningEvent = {
    schemaVersion: 'training-conditioning-log-event.v1', eventId: 'conditioning-event-1',
    eventType: 'conditioning_actual_recorded', eventRevision: 1, replacesEventId: null,
    subjectId, sessionId: 'session-1', boutId: 'session-1', modalityId: 'walking.v1',
    executionContext: { kind: 'live' }, actor: { kind: 'athlete', userId },
    serverAt: '2026-09-08T00:00:01Z', ...conditioningActual,
  }
  const conditioningAck = {
    schemaVersion: 'training-mutation-ack.v1', requestId, sessionId: 'session-1', revision: 3,
    state: 'in_progress', conditioningEvent,
  }
  it('saves duration and explicitly unknown effort without accepting browser authority', async () => {
    rpc.mockResolvedValueOnce({ data: conditioningAck, error: null })
    const response = await saveConditioning(request({ requestId, expectedRevision: 2, actual: conditioningActual }), params)
    expect(response.status).toBe(200)
    expect(rpc).toHaveBeenCalledWith('write_training_conditioning_log', {
      p_session_id: 'session-1', p_expected_revision: 2, p_request_id: requestId, p_actual: conditioningActual,
    })
    expect((await response.json()).conditioningEvent.perceivedEffort).toBe('unknown')
  })
  it('rejects fractional duration, impossible effort and forged actor/context', async () => {
    for (const extra of [{ durationSeconds: 1.5 }, { perceivedEffort: 11 }, { actor: { userId } }, { executionContext: { kind: 'live' } }]) {
      expect((await saveConditioning(request({ requestId, expectedRevision: 2, actual: { ...conditioningActual, ...extra } }), params)).status).toBe(422)
    }
    expect(rpc).not.toHaveBeenCalled()
  })
  it('rejects a cross-session or cross-actor conditioning acknowledgement', async () => {
    for (const extra of [{ sessionId: 'other' }, { actor: { kind: 'athlete', userId: 'other' } }]) {
      rpc.mockResolvedValueOnce({ data: { ...conditioningAck, conditioningEvent: { ...conditioningEvent, ...extra } }, error: null })
      expect((await saveConditioning(request({ requestId, expectedRevision: 2, actual: conditioningActual }), params)).status).toBe(503)
    }
  })
  it('does not expose conditioning actuals without their frozen prescription', async () => {
    rpc.mockResolvedValueOnce({ data: { ...projection, currentConditioningActual: conditioningEvent }, error: null })
    expect((await GET(request({}), params)).status).toBe(503)
  })
})
