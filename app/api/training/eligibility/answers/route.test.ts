import { beforeEach, describe, expect, it, vi } from 'vitest'
import { trainingRequestContext } from '@/lib/training/persistence/request-context'
import { GET, POST } from './route'

vi.mock('@/lib/training/persistence/request-context', () => ({ trainingRequestContext: vi.fn() }))
const rpc = vi.fn()
const maybeSingle = vi.fn()
const query = { select: vi.fn(), eq: vi.fn(), order: vi.fn(), limit: vi.fn(), maybeSingle }
const from = vi.fn()
const subjectId = '10000000-0000-4000-8000-000000000001'
const actor = { ok: true, actorKind: 'athlete', userId: '10000000-0000-4000-8000-000000000002', subjectId }
const answers = {
  adultScope: 'confirmed_18_plus', currentActivity: 'regularly_active',
  knownConditions: { cardiovascular: 'no', metabolic: 'no', renal: 'unknown' },
  relevantSignsOrSymptoms: 'unknown', desiredIntensity: 'moderate', answerCertainty: 'uncertain',
  pregnancyPostpartumContext: 'prefer_not_to_say', requestedProgrammingScope: 'strength_or_general_fitness',
}
const request = (body: unknown) => new Request('http://localhost/api/training/eligibility/answers', {
  method: 'POST', body: JSON.stringify(body),
})

beforeEach(() => {
  from.mockReset().mockReturnValue(query)
  for (const step of [query.select, query.eq, query.order, query.limit]) step.mockReset().mockReturnValue(query)
  maybeSingle.mockReset().mockResolvedValue({ data: null, error: null })
  rpc.mockReset().mockImplementation(async (_name, args) => ({ data: [{
    revision: args.p_expected_revision + 1, source_revision_id: args.p_source_revision_id,
    answers_hash: 'a'.repeat(64), hash_encoding: 'postgres-jsonb-text-utf8.v1',
  }], error: null }))
  vi.mocked(trainingRequestContext).mockReset().mockResolvedValue({ ok: true, actor, supabase: { rpc, from } } as never)
})

describe('athlete eligibility answer submission', () => {
  it('reads only the signed-in athlete latest answers through RLS', async () => {
    const response = await GET()
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ schemaVersion: 'training-eligibility-answers-projection.v1', subjectId, current: null })
    expect(query.eq).toHaveBeenCalledWith('subject_id', subjectId)
    expect(query.order).toHaveBeenCalledWith('revision', { ascending: false })
    expect(query.limit).toHaveBeenCalledWith(1)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
  })

  it('does not turn failed answer reads into an unanswered state', async () => {
    maybeSingle.mockResolvedValue({ data: null, error: { code: 'XX000' } })
    expect((await GET()).status).toBe(503)
  })

  it('derives subject and provenance, preserves unknown answers, and creates no clearance', async () => {
    const response = await POST(request({ expectedRevision: 2, answers }))
    expect(response.status).toBe(201)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(await response.json()).toMatchObject({ subjectId, revision: 3, status: 'answers_saved', decisionCreated: false })
    expect(trainingRequestContext).toHaveBeenCalledWith(true)
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith('append_training_eligibility_response', expect.objectContaining({
      p_subject_id: subjectId, p_expected_revision: 2,
      p_source_revision_id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      p_answers_json: expect.objectContaining({ ...answers, origin: { kind: 'athlete_self_report' },
        questionnaireSourceVersion: 'preparticipation-inputs.v1-unvalidated', submittedAt: expect.any(String) }),
    }))
  })

  it.each([
    { expectedRevision: 0, answers, subjectId: 'another-subject' },
    { expectedRevision: 0, answers: { ...answers, origin: { kind: 'synthetic_fixture' } } },
    { expectedRevision: 0, answers: { ...answers, submittedAt: '2020-01-01T00:00:00Z' } },
    { expectedRevision: 0, answers: { ...answers, state: 'eligible_general' } },
  ])('rejects client authority or provenance fields', async body => {
    expect((await POST(request(body))).status).toBe(422)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('does not let a coach answer on behalf of an athlete', async () => {
    vi.mocked(trainingRequestContext).mockResolvedValue({ ok: true, actor: { ...actor, actorKind: 'practitioner', subjectId: null }, supabase: { rpc } } as never)
    expect((await POST(request({ expectedRevision: 0, answers }))).status).toBe(403)
    expect(rpc).not.toHaveBeenCalled()
  })

  it.each(['PT409', '40001'])('preserves concurrency conflict %s without claiming saved answers', async code => {
    rpc.mockResolvedValue({ data: null, error: { code } })
    const response = await POST(request({ expectedRevision: 0, answers }))
    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: 'eligibility_answers_revision_conflict', action: 'refresh_answers' })
  })

  it('does not treat a failed actor gate as an empty profile', async () => {
    vi.mocked(trainingRequestContext).mockResolvedValue({ ok: false, response: new Response(null, { status: 401 }) } as never)
    expect((await POST(request({ expectedRevision: 0, answers }))).status).toBe(401)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('rejects an unrelated or malformed persistence receipt', async () => {
    rpc.mockResolvedValue({ data: [{ revision: 1, source_revision_id: subjectId, answers_hash: 'a'.repeat(64), hash_encoding: 'postgres-jsonb-text-utf8.v1' }], error: null })
    expect((await POST(request({ expectedRevision: 0, answers }))).status).toBe(503)
  })
})
