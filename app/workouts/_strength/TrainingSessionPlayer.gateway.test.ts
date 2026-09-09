import { afterEach, describe, expect, it, vi } from 'vitest'
import { createLoadQuantity } from '@/lib/training/quantity'
import {
  classifyTrainingOfflineReplay,
  readTrainingSession,
  replayTrainingOfflineEntry,
  saveTrainingConditioning,
  saveTrainingSet,
  startTrainingSession,
  TrainingRevisionConflict,
} from './TrainingSessionPlayer.gateway'
import type { TrainingOfflineStoredEntry } from '@/lib/training/offline'

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

    await saveTrainingSet({
      requestId: '46000000-0000-4000-8000-000000000001',
      sessionId: 'session-1', setId: 'set-1', expectedRevision: 2, actual,
    })

    const body = JSON.parse(String(fetch.mock.calls[0][1]?.body)) as Record<string, unknown>
    expect(body).toMatchObject({
      requestId: '46000000-0000-4000-8000-000000000001', expectedRevision: 2, actual,
    })
    expect(body).not.toHaveProperty('actor')
    expect(body).not.toHaveProperty('executionContext')
  })

  it('surfaces a 409 with the authorized current projection for explicit reload', async () => {
    const fetch = vi.fn(async () => response({ error: 'training_revision_conflict', current: projection }, 409))
    vi.stubGlobal('fetch', fetch)

    const promise = saveTrainingConditioning({
      requestId: '46000000-0000-4000-8000-000000000002',
      sessionId: 'session-1', expectedRevision: 1,
      actual: { durationSeconds: 600, perceivedEffort: 'unknown', symptomState: 'none', occurredAt: '2026-09-14T12:00:00Z' },
    })
    await expect(promise).rejects.toBeInstanceOf(TrainingRevisionConflict)
  })

  it('does not load a conflict projection for another session', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response({
      error: 'training_revision_conflict',
      current: { ...projection, session: { ...projection.session, id: 'session-2' } },
    }, 409)))

    await expect(saveTrainingConditioning({
      requestId: '46000000-0000-4000-8000-000000000088',
      sessionId: 'session-1', expectedRevision: 2,
      actual: { durationSeconds: 600, perceivedEffort: 'unknown', symptomState: 'none', occurredAt: '2026-09-14T12:00:00Z' },
    })).rejects.not.toBeInstanceOf(TrainingRevisionConflict)
  })

  it('rejects a projection for a different session', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response({ ...projection, session: { ...session, id: 'other-session' } })))
    await expect(readTrainingSession('session-1')).rejects.toThrow('response was invalid')
  })

  it('accepts only media bound to the exact prescribed catalog and exercise version', async () => {
    const prescription = {
      schemaVersion: 'training-session-prescription.v1',
      sessionId: 'session-1',
      subjectId: session.subject_id,
      assignmentId: session.assignment_id,
      executionContext: { kind: 'live' },
      catalogVersion: 'catalog:test:v1',
      catalogOrigin: { kind: 'authored_catalog' },
      exercises: [{
        exerciseInstanceId: 'exercise:test:1',
        exerciseVersionId: 'exercise-version:test:v1',
      }],
    }
    const media = {
      schemaVersion: 'training-launch-media-projection.v1',
      status: 'available',
      binding: {
        catalogVersion: prescription.catalogVersion,
        catalogOrigin: prescription.catalogOrigin,
        exerciseVersionId: prescription.exercises[0].exerciseVersionId,
      },
      review: {
        kind: 'qualified_exact_variant',
        reviewRecordId: 'review:test:v1',
        reviewedAt: '2026-09-01T12:00:00Z',
      },
      source: {
        rightsRecordId: 'rights:test:v1',
        provider: 'example-provider',
        assetId: 'asset:test:v1',
        sourcePageUrl: 'https://media.example.test/exercise',
        author: 'Example Author',
        license: {
          identifier: 'CC-BY-SA-4.0',
          name: 'Creative Commons Attribution-ShareAlike 4.0',
          url: 'https://creativecommons.org/licenses/by-sa/4.0/',
        },
      },
      assets: {
        poster: {
          path: '/training-media/exercise-test-v1.webp',
          alt: 'Exact exercise setup.',
          width: 1200,
          height: 630,
        },
      },
      expiresAt: null,
    }
    const withMedia = {
      ...projection,
      prescription,
      exerciseDisplay: {
        'exercise:test:1': {
          label: 'Test exercise',
          textInstruction: 'Keep the written instruction available.',
          mediaStatus: 'reviewed_exact_variant',
          media,
        },
      },
    }

    vi.stubGlobal('fetch', vi.fn(async () => response(withMedia)))
    await expect(readTrainingSession('session-1')).resolves.toMatchObject({
      exerciseDisplay: { 'exercise:test:1': { media: { status: 'available' } } },
    })

    for (const invalidMedia of [
      { ...media, binding: { ...media.binding, exerciseVersionId: 'exercise-version:other:v1' } },
      { ...media, assets: { poster: { ...media.assets.poster, path: 'https://cdn.example.test/exercise.webp' } } },
    ]) {
      vi.stubGlobal('fetch', vi.fn(async () => response({
        ...withMedia,
        exerciseDisplay: {
          'exercise:test:1': { ...withMedia.exerciseDisplay['exercise:test:1'], media: invalidMedia },
        },
      })))
      await expect(readTrainingSession('session-1')).rejects.toThrow('response was invalid')
    }
  })

  it('keeps business conflicts distinct from revision conflicts so unsaved editors remain mounted', async () => {
    const incomplete = vi.fn(async () => response({
      error: 'training_completion_incomplete', action: 'log_remaining_or_finish_with_omissions',
    }, 409))
    vi.stubGlobal('fetch', incomplete)
    await expect(saveTrainingConditioning({
      requestId: '46000000-0000-4000-8000-000000000003',
      sessionId: 'session-1', expectedRevision: 2,
      actual: { durationSeconds: 600, perceivedEffort: 'unknown', symptomState: 'none', occurredAt: '2026-09-14T12:00:00Z' },
    })).rejects.toThrow(/finish with omissions/i)

    vi.stubGlobal('fetch', vi.fn(async () => response({
      error: 'training_request_id_conflict', action: 'retry_with_new_request',
    }, 409)))
    await expect(saveTrainingConditioning({
      requestId: '46000000-0000-4000-8000-000000000004',
      sessionId: 'session-1', expectedRevision: 2,
      actual: { durationSeconds: 600, perceivedEffort: 'unknown', symptomState: 'none', occurredAt: '2026-09-14T12:00:00Z' },
    })).rejects.toThrow(/Try saving again/i)
  })

  it('marks transport and server failures retryable while rejecting validation failures as a new attempt', async () => {
    const input = {
      requestId: '46000000-0000-4000-8000-000000000005',
      sessionId: 'session-1', expectedRevision: 2,
      actual: { durationSeconds: 600, perceivedEffort: 'unknown' as const, symptomState: 'none' as const, occurredAt: '2026-09-14T12:00:00Z' },
    }
    vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new TypeError('network lost')))
    await expect(saveTrainingConditioning(input)).rejects.toMatchObject({ canRetryExact: true })

    vi.stubGlobal('fetch', vi.fn(async () => response({ error: 'training_save_unavailable' }, 503)))
    await expect(saveTrainingConditioning(input)).rejects.toMatchObject({ canRetryExact: true })

    vi.stubGlobal('fetch', vi.fn(async () => response({ error: 'invalid_training_payload' }, 422)))
    await expect(saveTrainingConditioning(input)).rejects.toMatchObject({ canRetryExact: false })
  })

  it('does not acknowledge a response for a different request ID', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response({
      schemaVersion: 'training-mutation-ack.v1', requestId: '46000000-0000-4000-8000-000000000099',
      sessionId: 'session-1', revision: 3, state: 'in_progress',
    })))
    await expect(saveTrainingConditioning({
      requestId: '46000000-0000-4000-8000-000000000006',
      sessionId: 'session-1', expectedRevision: 2,
      actual: { durationSeconds: 600, perceivedEffort: 'unknown', symptomState: 'none', occurredAt: '2026-09-14T12:00:00Z' },
    })).rejects.toMatchObject({ canRetryExact: true, code: 'invalid_ack' })
  })

  it('maps only concrete server codes to destructive offline outcomes', async () => {
    const failed = async (body: unknown, status: number) => {
      vi.stubGlobal('fetch', vi.fn(async () => response(body, status)))
      try {
        await saveTrainingConditioning({
          requestId: '46000000-0000-4000-8000-000000000007',
          sessionId: 'session-1', expectedRevision: 2,
          actual: { durationSeconds: 600, perceivedEffort: 'unknown', symptomState: 'none', occurredAt: '2026-09-14T12:00:00Z' },
        })
      } catch (cause) {
        return classifyTrainingOfflineReplay(cause)
      }
      throw new Error('expected failure')
    }

    await expect(failed({ error: 'unauthorized' }, 401)).resolves.toEqual({
      kind: 'denied', scope: 'user', reason: 'unauthenticated',
    })
    await expect(failed({ error: 'training_action_unavailable' }, 403)).resolves.toEqual({
      kind: 'denied', scope: 'session', reason: 'action_unavailable',
    })
    await expect(failed({ error: 'relationship_revoked' }, 403)).resolves.toEqual({
      kind: 'denied', scope: 'session', reason: 'relationship_revoked',
    })
    await expect(failed({ error: 'assignment_expired' }, 403)).resolves.toEqual({
      kind: 'denied', scope: 'session', reason: 'assignment_expired',
    })
    await expect(failed({ error: 'training_session_stale', action: 'review_or_abort' }, 409)).resolves.toEqual({
      kind: 'rejected', reason: 'training_session_stale',
    })
    await expect(failed({ error: 'invalid_training_payload' }, 422)).resolves.toEqual({
      kind: 'rejected', reason: 'invalid_training_payload',
    })
    await expect(failed({ code: 'session_stale' }, 403)).resolves.toEqual({ kind: 'retry_later' })
    await expect(failed({ code: 'athlete_access_required' }, 403)).resolves.toEqual({ kind: 'retry_later' })
  })

  it('replays the exact stored conditioning envelope without changing its timestamp or ID', async () => {
    const entry = {
      sequence: 1, fingerprint: 'a'.repeat(64), status: 'pending',
      envelope: {
        schemaVersion: 'training-offline-envelope.v1', queuedAt: '2026-09-14T12:01:00Z',
        userId: '10000000-0000-4000-8000-000000000009', subjectId: session.subject_id,
        requestId: '46000000-0000-4000-8000-000000000008', sessionId: 'session-1',
        mutation: {
          kind: 'conditioning_actual', expectedRevision: 2,
          actual: { durationSeconds: 600, perceivedEffort: 'unknown', symptomState: 'none', occurredAt: '2026-09-14T12:00:00Z' },
        },
      },
    } as const satisfies TrainingOfflineStoredEntry
    const requests: RequestInit[] = []
    const fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requests.push(init ?? {})
      return response({
      schemaVersion: 'training-mutation-ack.v1', requestId: entry.envelope.requestId,
      sessionId: entry.envelope.sessionId, revision: 3, state: 'in_progress',
      })
    })
    vi.stubGlobal('fetch', fetch)

    await replayTrainingOfflineEntry(entry)

    expect(JSON.parse(String(requests[0].body))).toEqual({
      requestId: entry.envelope.requestId,
      expectedRevision: 2,
      actual: entry.envelope.mutation.actual,
    })
  })

  it('replays an abort with the exact stored request ID, revision, and finish mode', async () => {
    const entry = {
      sequence: 2, fingerprint: 'b'.repeat(64), status: 'pending',
      envelope: {
        schemaVersion: 'training-offline-envelope.v1', queuedAt: '2026-09-14T12:02:00Z',
        userId: '10000000-0000-4000-8000-000000000009', subjectId: session.subject_id,
        requestId: '46000000-0000-4000-8000-000000000009', sessionId: 'session-1',
        mutation: { kind: 'session_completion', expectedRevision: 4, finishMode: 'abort' },
      },
    } as const satisfies TrainingOfflineStoredEntry
    const completion = vi.fn(async () => ({
      schemaVersion: 'training-mutation-ack.v1' as const,
      requestId: entry.envelope.requestId,
      sessionId: entry.envelope.sessionId,
      revision: 5,
      state: 'aborted' as const,
    }))

    await replayTrainingOfflineEntry(entry, undefined, {
      set: vi.fn(), conditioning: vi.fn(), completion,
    })

    expect(completion).toHaveBeenCalledWith({
      requestId: entry.envelope.requestId,
      sessionId: entry.envelope.sessionId,
      expectedRevision: 4,
      finishMode: 'abort',
    }, undefined)
  })
})
