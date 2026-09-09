import { afterEach, describe, expect, it, vi } from 'vitest'
import { requestTrainingExplanationSelection, trainingExplanationProviderConfiguration } from './provider.server'

const configuration = { provider: 'openrouter' as const, apiKey: 'test-only-key', model: 'configured-test-model' }
const facts = [{ factId: 'cycle', text: 'This draft spans 8 weeks.' }]

afterEach(() => vi.useRealTimers())

describe('training explanation provider', () => {
  it('does not call a provider without complete configured credentials', async () => {
    const fetch = vi.fn()
    expect(trainingExplanationProviderConfiguration({})).toBeUndefined()
    expect(trainingExplanationProviderConfiguration({ POSTURE_WORKOUT_AI_PROVIDER: 'unknown' })).toBeUndefined()
    expect(trainingExplanationProviderConfiguration({ POSTURE_WORKOUT_OPENROUTER_API_KEY: 'key' })).toBeUndefined()
    expect(await requestTrainingExplanationSelection(facts, undefined, { fetch })).toBeUndefined()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('sends only authored fact IDs and text to the configured approved host', async () => {
    const selection = { schemaVersion: 'training-build-explanation-selection.v1', orderedFactIds: ['cycle'] }
    const fetch = vi.fn().mockResolvedValue(Response.json({ choices: [{ message: { content: JSON.stringify(selection) } }] }))
    const richerFacts = [{ ...facts[0], subjectId: 'must-not-be-sent', captureImage: 'must-not-be-sent' }]
    expect(await requestTrainingExplanationSelection(richerFacts, configuration, { fetch })).toEqual(selection)
    const [url, init] = fetch.mock.calls[0]
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions')
    const sent = JSON.parse(init.body)
    expect(JSON.parse(sent.messages[1].content)).toEqual({ facts })
    expect(init.body).not.toContain('must-not-be-sent')
    expect(sent.model).toBe(configuration.model)
    expect(sent.max_tokens).toBe(512)
  })

  it('uses only the explicitly selected DeepSeek host and existing configuration names', async () => {
    const selected = trainingExplanationProviderConfiguration({
      POSTURE_WORKOUT_AI_PROVIDER: 'deepseek',
      POSTURE_WORKOUT_DEEPSEEK_API_KEY: 'test-only-key',
      POSTURE_WORKOUT_DEEPSEEK_MODEL: 'test-model',
    })
    const fetch = vi.fn().mockResolvedValue(Response.json({ choices: [] }))
    await requestTrainingExplanationSelection(facts, selected, { fetch })
    expect(fetch.mock.calls[0][0]).toBe('https://api.deepseek.com/chat/completions')
  })

  it.each([
    Response.json({ error: 'unavailable' }, { status: 503 }),
    Response.json({ choices: [] }),
    Response.json({ choices: [{ message: { content: 'invalid JSON' } }] }),
    Response.json({ choices: [{ message: { content: 'x'.repeat(8_193) } }] }),
  ])('returns no selection when the provider response is unusable', async response => {
    expect(await requestTrainingExplanationSelection(facts, configuration, {
      fetch: vi.fn().mockResolvedValue(response),
    })).toBeUndefined()
  })

  it('stops reading an oversized response before parsing it', async () => {
    const cancel = vi.fn()
    const response = new Response(new ReadableStream({
      start(controller) { controller.enqueue(new Uint8Array(32_769)) },
      cancel,
    }))
    expect(await requestTrainingExplanationSelection(facts, configuration, {
      fetch: vi.fn().mockResolvedValue(response),
    })).toBeUndefined()
    expect(cancel).toHaveBeenCalledOnce()
  })

  it('bounds a stalled provider even when the transport ignores abort', async () => {
    vi.useFakeTimers()
    const fetch = vi.fn().mockImplementation(() => new Promise(() => {}))
    const pending = requestTrainingExplanationSelection(facts, configuration, { fetch, timeoutMs: 50 })
    await vi.advanceTimersByTimeAsync(50)
    await expect(pending).resolves.toBeUndefined()
    expect(fetch.mock.calls[0][1].signal.aborted).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('converts transport failure into the deterministic-fallback signal', async () => {
    expect(await requestTrainingExplanationSelection(facts, configuration, {
      fetch: vi.fn().mockRejectedValue(new Error('offline')),
    })).toBeUndefined()
  })
})
