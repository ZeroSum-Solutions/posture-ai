// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useDelayedBusy } from './useDelayedBusy'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useDelayedBusy', () => {
  it('does not show before the delay elapses', () => {
    const { result, rerender } = renderHook(({ busy }) => useDelayedBusy(busy, { delay: 300, min: 500 }), {
      initialProps: { busy: true },
    })
    expect(result.current).toBe(false)

    act(() => {
      vi.advanceTimersByTime(299)
    })
    expect(result.current).toBe(false)

    rerender({ busy: true })
  })

  it('shows once the delay elapses', () => {
    const { result } = renderHook(({ busy }) => useDelayedBusy(busy, { delay: 300, min: 500 }), {
      initialProps: { busy: true },
    })

    act(() => {
      vi.advanceTimersByTime(300)
    })
    expect(result.current).toBe(true)
  })

  it('never shows a load that resolves before the delay', () => {
    const { result, rerender } = renderHook(({ busy }) => useDelayedBusy(busy, { delay: 300, min: 500 }), {
      initialProps: { busy: true },
    })

    act(() => {
      vi.advanceTimersByTime(150)
    })
    rerender({ busy: false })
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(result.current).toBe(false)
  })

  it('stays visible at least the minimum even after busy clears', () => {
    const { result, rerender } = renderHook(({ busy }) => useDelayedBusy(busy, { delay: 300, min: 500 }), {
      initialProps: { busy: true },
    })

    act(() => {
      vi.advanceTimersByTime(300)
    })
    expect(result.current).toBe(true)

    // Busy clears almost immediately after showing.
    rerender({ busy: false })
    act(() => {
      vi.advanceTimersByTime(100)
    })
    expect(result.current).toBe(true)

    act(() => {
      vi.advanceTimersByTime(400)
    })
    expect(result.current).toBe(false)
  })
})
