import { describe, expect, test, vi } from 'vitest'
import { createOverrideQueue, type OverridePatch } from './overrideQueue'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

describe('createOverrideQueue', () => {
  test('serializes rapid patches and keeps dependent actions waiting for the tail', async () => {
    const first = deferred<boolean>()
    const second = deferred<boolean>()
    const save = vi.fn((patch: OverridePatch) => patch.capability ? first.promise : second.promise)
    const queue = createOverrideQueue(save)

    const firstSave = queue.enqueue({ capability: 'standard' })
    const secondSave = queue.enqueue({ priority_keys: ['forward_head_posture'] })
    const dependentAction = queue.waitForSettled()

    await Promise.resolve()
    expect(save).toHaveBeenCalledTimes(1)
    expect(queue.getState()).toBe('saving')

    first.resolve(true)
    await firstSave
    await Promise.resolve()
    expect(save).toHaveBeenCalledTimes(2)
    expect(queue.getState()).toBe('saving')

    second.resolve(true)
    await expect(secondSave).resolves.toBe(true)
    await expect(dependentAction).resolves.toBe(true)
    expect(queue.getState()).toBe('idle')
  })

  test('keeps a failed save sticky until the exact patch retries successfully', async () => {
    const patch: OverridePatch = { exercise_swaps: { posture: { base: 'replacement' } } }
    const save = vi.fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)
    const states: string[] = []
    const queue = createOverrideQueue(save, (state) => states.push(state))

    await expect(queue.enqueue(patch)).resolves.toBe(false)
    await expect(queue.waitForSettled()).resolves.toBe(false)
    expect(queue.getState()).toBe('failed')

    await expect(queue.retryFailed()).resolves.toBe(true)
    expect(save).toHaveBeenNthCalledWith(2, patch)
    expect(queue.getState()).toBe('idle')
    expect(states).toContain('failed')
  })

  test('turns a thrown network error into a recoverable failed state', async () => {
    const queue = createOverrideQueue(async () => { throw new Error('offline') })

    await expect(queue.enqueue({ capability: 'regression' })).resolves.toBe(false)
    await expect(queue.waitForSettled()).resolves.toBe(false)
    expect(queue.getState()).toBe('failed')
  })
})
