import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSampleScan } from '@/lib/demo/scan'
import { DEFAULT_WORKOUT_PREFERENCES, workoutCandidates } from '@/lib/demo/workout'
const guard = vi.hoisted(() => vi.fn())
vi.mock('@/lib/demo/api-guard', () => ({ guardDemoGeneration: guard }))
import { POST } from './route'
const findings = createSampleScan().result.findings
const request = () => new Request('https://demo.example/api/demo/workouts/generate', { method: 'POST', body: JSON.stringify({ findings, preferences: DEFAULT_WORKOUT_PREFERENCES }) })
beforeEach(() => { guard.mockResolvedValue(null); vi.stubEnv('POSTURE_DEMO_OPENROUTER_API_KEY', 'unit-test-key'); vi.stubEnv('POSTURE_DEMO_OPENROUTER_MODEL', 'unit-test-model') })
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.clearAllMocks() })
describe('demo AI generation route', () => {
  it('returns a validated AI-selected snapshot and sends no scan identity or photos', async () => {
    const candidates = workoutCandidates(findings, DEFAULT_WORKOUT_PREFERENCES)!
    const fetcher = vi.fn().mockResolvedValue(Response.json({ choices: [{ message: { content: JSON.stringify({ slugs: candidates.items.slice(0, 2).map((item) => item.slug) }) } }] }))
    vi.stubGlobal('fetch', fetcher)
    const response = await POST(request())
    const body = await response.json()
    expect(body.source).toBe('ai')
    expect(body.snapshot.items.map((item: { slug: string }) => item.slug)).toEqual(candidates.items.slice(0, 2).map((item) => item.slug))
    const sent = JSON.parse(fetcher.mock.calls[0][1].body)
    expect(sent.messages[1].content).not.toMatch(/scanId|image|createdAt|landmark|confidence|deviation/)
    expect(sent.max_tokens).toBe(1200)
  })
  it('labels provider failure and invalid exercise selections as scan-based fallback', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ choices: [{ message: { content: '{"slugs":["made-up"]}' } }] })))
    const body = await (await POST(request())).json()
    expect(body.source).toBe('scan')
    expect(body.notice).toMatch(/AI could not finish/)
    expect(body.snapshot.items.some((item: { slug: string }) => item.slug === 'made-up')).toBe(false)
  })
  it('enforces the API guard before provider calls', async () => {
    guard.mockResolvedValue(Response.json({ error: 'Too many requests' }, { status: 429 }))
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher)
    expect((await POST(request())).status).toBe(429)
    expect(fetcher).not.toHaveBeenCalled()
  })
})
