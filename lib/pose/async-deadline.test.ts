import { afterEach, describe, expect, it, vi } from 'vitest'
import { AsyncDeadlineError, settleBeforeDeadline } from './async-deadline'

afterEach(() => vi.useRealTimers())

describe('settleBeforeDeadline', () => {
  it('returns work that resolves inside the budget', async () => {
    await expect(settleBeforeDeadline(Promise.resolve('ready'), 10, vi.fn(), 'late')).resolves.toBe('ready')
  })

  it('preserves an early factory rejection', async () => {
    await expect(settleBeforeDeadline(Promise.reject(new Error('GPU failed')), 10, vi.fn(), 'late'))
      .rejects.toThrow('GPU failed')
  })

  it('rejects at the deadline and disposes a value that resolves late', async () => {
    vi.useFakeTimers()
    let resolveWork!: (value: { close: () => void }) => void
    const close = vi.fn()
    const work = new Promise<{ close: () => void }>(resolve => { resolveWork = resolve })
    const bounded = settleBeforeDeadline(work, 50, value => value.close(), 'delegate timed out')

    const rejection = expect(bounded).rejects.toBeInstanceOf(AsyncDeadlineError)
    await vi.advanceTimersByTimeAsync(50)
    await rejection
    resolveWork({ close })
    await Promise.resolve()

    expect(close).toHaveBeenCalledOnce()
  })
})
