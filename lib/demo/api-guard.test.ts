import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ service: vi.fn(), rate: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServiceClient: mocks.service }))
vi.mock('@/lib/rate-limit', () => ({ enforceRateLimitStrict: mocks.rate }))
import { guardDemoGeneration } from './api-guard'

const request = (headers: Record<string, string> = {}) => new Request('https://example.test/api/demo/workouts/generate', {
  method: 'POST', headers: { origin: 'https://example.test', 'content-type': 'application/json', ...headers },
})
describe('prototype AI spending boundary', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.service.mockReturnValue({}); mocks.rate.mockResolvedValue(true) })
  it('rejects other origins before database or provider access', async () => {
    expect((await guardDemoGeneration(request({ origin: 'https://attacker.test' })))?.status).toBe(403)
    expect(mocks.service).not.toHaveBeenCalled()
  })
  it('requires JSON and bounded length', async () => {
    expect((await guardDemoGeneration(request({ 'content-type': 'text/plain' })))?.status).toBe(415)
    expect((await guardDemoGeneration(request({ 'content-length': '32769' })))?.status).toBe(413)
  })
  it('applies both address and global quotas', async () => {
    expect(await guardDemoGeneration(request())).toBeNull()
    expect(mocks.rate).toHaveBeenNthCalledWith(1, {}, expect.objectContaining({ route: 'demo_ai', limit: 12 }))
    expect(mocks.rate).toHaveBeenNthCalledWith(2, {}, expect.objectContaining({ route: 'demo_ai_budget', limit: 150 }))
  })
  it('denies a exhausted global quota', async () => {
    mocks.rate.mockResolvedValueOnce(true).mockResolvedValueOnce(false)
    expect((await guardDemoGeneration(request()))?.status).toBe(429)
  })
  it('denies database failure without a paid request', async () => {
    mocks.service.mockImplementation(() => { throw new Error('offline') })
    expect((await guardDemoGeneration(request()))?.status).toBe(503)
  })
})
