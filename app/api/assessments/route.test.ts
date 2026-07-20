import { describe, test, expect, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { testLandmarksFrames } from '@posture-ai/engine'
import { MAX_PAYLOAD_BYTES } from '@/lib/validation/frames'

interface StoredAssessment {
  id: string
  practitioner_id: string
  submission_id: string
  submission_digest: string
  status: string
  [key: string]: unknown
}

const mockState = vi.hoisted(() => ({ service: null as unknown }))

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
    from: () => ({}),
  }),
  createSupabaseServiceClient: () => mockState.service,
}))
vi.mock('@/lib/auth/requirePractitioner', () => ({ practitionerGate: async () => null }))
vi.mock('@/lib/rate-limit', () => ({ enforceRateLimit: async () => true }))
vi.mock('@/lib/consent/record', () => ({
  getConsentStatus: async () => ({ hasConsent: true }),
  captureEligibility: () => ({ ok: true }),
}))

import { POST } from './route'

const CLIENT_ID = '2f5d3f6a-4b1c-4f6e-9b3a-1c2d3e4f5a6b'
const SUBMISSION_A = '6a76a8b9-df1d-4e93-a65b-33419bb01bb4'
const SUBMISSION_B = '65a5f322-0d90-4ba2-bf2e-2201958dd668'

function validFrames() {
  const front = testLandmarksFrames.find(frame => frame.view === 'front')!
  const side = testLandmarksFrames.find(frame => frame.view === 'side')!
  return [
    { ...front },
    { ...side, profileSide: 'left' as const },
    { ...side, profileSide: 'right' as const },
    { ...front, view: 'back' as const },
  ]
}

function assessmentReq(submissionId: string, frames = validFrames(), clientId = CLIENT_ID) {
  return new NextRequest('http://localhost/api/assessments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: clientId, submission_id: submissionId, frames }),
  })
}

function makeAssessmentService() {
  const assessments: StoredAssessment[] = []
  let nextId = 0
  let captureInsertCount = 0
  let findingInsertCount = 0
  let hiddenExistingReads = 0

  const service = {
    from(table: string) {
      if (table === 'clients') {
        return {
          select() {
            const query = {
              eq() { return query },
              is() { return query },
              async maybeSingle() { return { data: { id: CLIENT_ID, date_of_birth: '1990-01-01' }, error: null } },
            }
            return query
          },
        }
      }
      if (table === 'assessments') {
        return {
          insert(row: Omit<StoredAssessment, 'id'>) {
            return {
              select() {
                return {
                  async single() {
                    const duplicate = assessments.find(existing =>
                      existing.practitioner_id === row.practitioner_id
                      && existing.submission_id === row.submission_id)
                    if (duplicate) {
                      return { data: null, error: { code: '23505', message: 'duplicate submission key' } }
                    }
                    const stored = { ...row, id: `assessment-${++nextId}` } as StoredAssessment
                    assessments.push(stored)
                    return { data: { id: stored.id }, error: null }
                  },
                }
              },
            }
          },
          select() {
            const filters: Record<string, unknown> = {}
            const query = {
              eq(column: string, value: unknown) { filters[column] = value; return query },
              async maybeSingle() {
                if (hiddenExistingReads > 0) {
                  hiddenExistingReads--
                  return { data: null, error: null }
                }
                const data = assessments.find(row => Object.entries(filters).every(([key, value]) => row[key] === value)) ?? null
                return { data, error: null }
              },
            }
            return query
          },
          update(patch: Record<string, unknown>) {
            return {
              async eq(column: string, value: unknown) {
                const stored = assessments.find(row => row[column] === value)
                if (stored) Object.assign(stored, patch)
                return { error: null }
              },
            }
          },
        }
      }
      if (table === 'captures') {
        return { async insert() { captureInsertCount++; return { error: null } } }
      }
      if (table === 'assessment_findings') {
        return { async insert() { findingInsertCount++; return { error: null } } }
      }
      throw new Error(`Unexpected table: ${table}`)
    },
  }

  return {
    service,
    snapshot: () => ({ assessments, captureInsertCount, findingInsertCount }),
    hideNextExistingRead: () => { hiddenExistingReads++ },
  }
}

// A streamed body carries no Content-Length header (routine on chunked/HTTP-2).
function streamedReq(bodyStr: string) {
  const stream = new ReadableStream({
    start(c) {
      c.enqueue(new TextEncoder().encode(bodyStr))
      c.close()
    },
  })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new NextRequest('http://localhost/api/assessments', { method: 'POST', body: stream, duplex: 'half' } as any)
}

describe('POST /api/assessments payload cap', () => {
  test('rejects an oversized body with 413 even when Content-Length is absent', async () => {
    const req = streamedReq('x'.repeat(MAX_PAYLOAD_BYTES + 100))
    expect(req.headers.get('content-length')).toBeNull()
    const res = await POST(req)
    expect(res.status).toBe(413)
  })
})

describe('POST /api/assessments submission identity', () => {
  test('concurrent same-key requests resolve to one assessment', async () => {
    const db = makeAssessmentService()
    mockState.service = db.service

    const [first, second] = await Promise.all([
      POST(assessmentReq(SUBMISSION_A)),
      POST(assessmentReq(SUBMISSION_A)),
    ])
    const firstBody = await first.json()
    const secondBody = await second.json()

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(firstBody.id).toBe(secondBody.id)
    expect(db.snapshot().assessments).toHaveLength(1)
    expect(db.snapshot()).toMatchObject({ captureInsertCount: 1, findingInsertCount: 1 })
  })

  test('same key and same canonical payload replays the existing assessment', async () => {
    const db = makeAssessmentService()
    mockState.service = db.service

    const first = await POST(assessmentReq(SUBMISSION_A))
    const replay = await POST(assessmentReq(SUBMISSION_A, validFrames().reverse()))

    expect(first.status).toBe(200)
    expect(replay.status).toBe(200)
    const firstBody = await first.json()
    const replayBody = await replay.json()
    expect(replayBody).toMatchObject({ id: firstBody.id, status: 'complete', replayed: true })
    expect(db.snapshot()).toMatchObject({ captureInsertCount: 1, findingInsertCount: 1 })
    expect(db.snapshot().assessments).toHaveLength(1)
  })

  test('a unique-index race resolves the winning assessment instead of returning 500', async () => {
    const db = makeAssessmentService()
    mockState.service = db.service
    const first = await POST(assessmentReq(SUBMISSION_A))
    const firstBody = await first.json()

    // Simulate a simultaneous request whose pre-insert read missed the row that
    // then won the unique-index race before this request's insert.
    db.hideNextExistingRead()
    const replay = await POST(assessmentReq(SUBMISSION_A))

    expect(replay.status).toBe(200)
    await expect(replay.json()).resolves.toMatchObject({ id: firstBody.id, replayed: true })
    expect(db.snapshot().assessments).toHaveLength(1)
  })

  test('same key with different scoring payload returns 409 without a second write', async () => {
    const db = makeAssessmentService()
    mockState.service = db.service
    expect((await POST(assessmentReq(SUBMISSION_A))).status).toBe(200)

    const changed = validFrames()
    changed[0] = {
      ...changed[0],
      landmarks: {
        ...changed[0].landmarks,
        left_shoulder: { ...changed[0].landmarks.left_shoulder, x: changed[0].landmarks.left_shoulder.x + 0.001 },
      },
    }
    const conflict = await POST(assessmentReq(SUBMISSION_A, changed))

    expect(conflict.status).toBe(409)
    await expect(conflict.json()).resolves.toMatchObject({ error: expect.stringMatching(/submission_id/i) })
    expect(db.snapshot().assessments).toHaveLength(1)
    expect(db.snapshot()).toMatchObject({ captureInsertCount: 1, findingInsertCount: 1 })
  })

  test('same key cannot be reused for another client', async () => {
    const db = makeAssessmentService()
    mockState.service = db.service
    expect((await POST(assessmentReq(SUBMISSION_A))).status).toBe(200)

    const conflict = await POST(assessmentReq(
      SUBMISSION_A,
      validFrames(),
      'b9c58d03-3bb8-453a-9f0d-b905762c77e0',
    ))

    expect(conflict.status).toBe(409)
    expect(db.snapshot().assessments).toHaveLength(1)
  })

  test('different keys create separate intentional assessments', async () => {
    const db = makeAssessmentService()
    mockState.service = db.service

    const first = await POST(assessmentReq(SUBMISSION_A))
    const second = await POST(assessmentReq(SUBMISSION_B))

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect((await first.json()).id).not.toBe((await second.json()).id)
    expect(db.snapshot().assessments).toHaveLength(2)
    expect(db.snapshot()).toMatchObject({ captureInsertCount: 2, findingInsertCount: 2 })
  })
})
