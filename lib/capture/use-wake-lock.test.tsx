// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useWakeLock } from './use-wake-lock'

type TestSentinel = {
  release: ReturnType<typeof vi.fn>
  emitRelease: () => void
}

function sentinel(): TestSentinel {
  let listener: (() => void) | null = null
  return {
    release: vi.fn().mockResolvedValue(undefined),
    emitRelease: () => listener?.(),
    addEventListener(type: string, next: () => void) {
      if (type === 'release') listener = next
    },
  } as TestSentinel
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

describe('useWakeLock', () => {
  const navigatorDescriptor = Object.getOwnPropertyDescriptor(navigator, 'wakeLock')
  const visibilityDescriptor = Object.getOwnPropertyDescriptor(document, 'visibilityState')
  let visibility: DocumentVisibilityState

  beforeEach(() => {
    visibility = 'visible'
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => visibility,
    })
  })

  afterEach(() => {
    if (navigatorDescriptor) Object.defineProperty(navigator, 'wakeLock', navigatorDescriptor)
    else delete (navigator as unknown as { wakeLock?: unknown }).wakeLock
    if (visibilityDescriptor) Object.defineProperty(document, 'visibilityState', visibilityDescriptor)
    vi.restoreAllMocks()
  })

  it('acquires a screen lock and releases it on request', async () => {
    const lock = sentinel()
    const request = vi.fn().mockResolvedValue(lock)
    Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request } })
    const { result } = renderHook(() => useWakeLock())

    await act(async () => { await result.current.acquire() })
    expect(request).toHaveBeenCalledOnce()
    expect(request).toHaveBeenCalledWith('screen')

    act(() => { result.current.release() })
    expect(lock.release).toHaveBeenCalledOnce()
  })

  it('reacquires after the browser releases the sentinel and the page returns visible', async () => {
    const first = sentinel()
    const second = sentinel()
    const request = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second)
    Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request } })
    const { result } = renderHook(() => useWakeLock())

    await act(async () => { await result.current.acquire() })
    act(() => {
      visibility = 'hidden'
      first.emitRelease()
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(request).toHaveBeenCalledOnce()

    await act(async () => {
      visibility = 'visible'
      document.dispatchEvent(new Event('visibilitychange'))
      await Promise.resolve()
    })
    expect(request).toHaveBeenCalledTimes(2)
  })

  it('reacquires when a backgrounded sentinel releases after the page is already visible', async () => {
    const first = sentinel()
    const second = sentinel()
    const request = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second)
    Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request } })
    const { result } = renderHook(() => useWakeLock())

    await act(async () => { await result.current.acquire() })
    act(() => {
      visibility = 'hidden'
      document.dispatchEvent(new Event('visibilitychange'))
      visibility = 'visible'
      document.dispatchEvent(new Event('visibilitychange'))
    })
    // The browser has not announced the old lock's release yet, so the visible
    // transition cannot request its replacement at this point.
    expect(request).toHaveBeenCalledOnce()

    await act(async () => {
      first.emitRelease()
      await Promise.resolve()
    })
    expect(request).toHaveBeenCalledTimes(2)

    act(() => { result.current.release() })
    expect(second.release).toHaveBeenCalledOnce()
  })

  it('releases a sentinel that resolves after explicit release', async () => {
    const pending = deferred<TestSentinel>()
    const lock = sentinel()
    Object.defineProperty(navigator, 'wakeLock', {
      configurable: true,
      value: { request: vi.fn().mockReturnValue(pending.promise) },
    })
    const { result } = renderHook(() => useWakeLock())

    let acquisition!: Promise<void>
    act(() => { acquisition = result.current.acquire() })
    act(() => { result.current.release() })
    await act(async () => { pending.resolve(lock); await acquisition })

    expect(lock.release).toHaveBeenCalledOnce()
  })

  it('releases a sentinel that resolves after unmount', async () => {
    const pending = deferred<TestSentinel>()
    const lock = sentinel()
    Object.defineProperty(navigator, 'wakeLock', {
      configurable: true,
      value: { request: vi.fn().mockReturnValue(pending.promise) },
    })
    const { result, unmount } = renderHook(() => useWakeLock())

    let acquisition!: Promise<void>
    act(() => { acquisition = result.current.acquire() })
    unmount()
    await act(async () => { pending.resolve(lock); await acquisition })

    expect(lock.release).toHaveBeenCalledOnce()
  })

  it('retires a pending request across backgrounding and reacquires when visible', async () => {
    const pending = deferred<TestSentinel>()
    const stale = sentinel()
    const fresh = sentinel()
    const request = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValueOnce(fresh)
    Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request } })
    const { result } = renderHook(() => useWakeLock())

    let acquisition!: Promise<void>
    act(() => { acquisition = result.current.acquire() })
    act(() => {
      visibility = 'hidden'
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await act(async () => { pending.resolve(stale); await acquisition })
    expect(stale.release).toHaveBeenCalledOnce()
    expect(request).toHaveBeenCalledOnce()

    await act(async () => {
      visibility = 'visible'
      document.dispatchEvent(new Event('visibilitychange'))
      await Promise.resolve()
    })
    expect(request).toHaveBeenCalledTimes(2)

    act(() => { result.current.release() })
    expect(fresh.release).toHaveBeenCalledOnce()
  })

  it('coalesces acquire calls while a browser request is pending', async () => {
    const pending = deferred<TestSentinel>()
    const request = vi.fn().mockReturnValue(pending.promise)
    Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request } })
    const { result } = renderHook(() => useWakeLock())

    let first!: Promise<void>
    let second!: Promise<void>
    act(() => {
      first = result.current.acquire()
      second = result.current.acquire()
    })
    expect(request).toHaveBeenCalledOnce()

    await act(async () => { pending.resolve(sentinel()); await Promise.all([first, second]) })
  })

  it('ignores a delayed release event from a replaced sentinel', async () => {
    const first = sentinel()
    const second = sentinel()
    const request = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second)
    Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request } })
    const { result } = renderHook(() => useWakeLock())

    await act(async () => { await result.current.acquire() })
    act(() => { result.current.release() })
    await act(async () => { await result.current.acquire() })
    act(() => { first.emitRelease() })
    act(() => { result.current.release() })

    expect(second.release).toHaveBeenCalledOnce()
  })

  it('degrades without throwing when the API is absent or rejects', async () => {
    delete (navigator as unknown as { wakeLock?: unknown }).wakeLock
    const { result, unmount } = renderHook(() => useWakeLock())
    await act(async () => { await result.current.acquire() })
    expect(() => result.current.release()).not.toThrow()
    unmount()

    const request = vi.fn().mockRejectedValue(new DOMException('denied', 'NotAllowedError'))
    Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request } })
    const rejected = renderHook(() => useWakeLock())
    await act(async () => { await rejected.result.current.acquire() })
    expect(request).toHaveBeenCalledOnce()
    rejected.unmount()
  })
})
