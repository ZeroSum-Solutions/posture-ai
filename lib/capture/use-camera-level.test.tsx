// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useCameraLevel } from './use-camera-level'

// Use an untyped alias to freely set/delete window.DeviceOrientationEvent in tests
// without conflicting with the strict DOM lib typings.
const w = window as unknown as Record<string, unknown>

function fireOrientation(beta: number, gamma: number) {
  const e = new Event('deviceorientation') as Event & { beta: number | null; gamma: number | null }
  Object.assign(e, { beta, gamma })
  window.dispatchEvent(e)
}

describe('useCameraLevel', () => {
  const originalDOE = w['DeviceOrientationEvent']

  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => {
    vi.useRealTimers()
    w['DeviceOrientationEvent'] = originalDOE
  })

  it('reports unsupported when DeviceOrientationEvent does not exist', () => {
    delete w['DeviceOrientationEvent']
    const { result } = renderHook(() => useCameraLevel())
    expect(result.current.permission).toBe('unsupported')
    expect(result.current.rollDeg).toBeNull()
  })

  it('listens immediately on non-iOS (no requestPermission) and reports roll', () => {
    w['DeviceOrientationEvent'] = class {} // no static requestPermission
    const { result } = renderHook(() => useCameraLevel())
    expect(result.current.permission).toBe('granted')
    act(() => { fireOrientation(80, 90) }) // pure 10° roll right
    expect(result.current.rollDeg).not.toBeNull()
    expect(result.current.rollDeg!).toBeCloseTo(10, 2)
    expect(result.current.rollRef.current).not.toBeNull()
  })

  it('downgrades to unsupported when no event arrives within the timeout', () => {
    w['DeviceOrientationEvent'] = class {}
    const { result } = renderHook(() => useCameraLevel())
    expect(result.current.permission).toBe('granted')
    act(() => { vi.advanceTimersByTime(2000) })
    expect(result.current.permission).toBe('unsupported')
  })

  it('exposes needs-request when iOS-style requestPermission exists, grants on success', async () => {
    w['DeviceOrientationEvent'] = class {
      static requestPermission = vi.fn().mockResolvedValue('granted')
    }
    const { result } = renderHook(() => useCameraLevel())
    expect(result.current.permission).toBe('needs-request')
    await act(async () => { await result.current.requestAccess() })
    expect(result.current.permission).toBe('granted')
  })

  it('reports denied when requestPermission rejects or returns denied', async () => {
    w['DeviceOrientationEvent'] = class {
      static requestPermission = vi.fn().mockResolvedValue('denied')
    }
    const { result } = renderHook(() => useCameraLevel())
    await act(async () => { await result.current.requestAccess() })
    expect(result.current.permission).toBe('denied')
  })

  // Post-restructure invariant: setState after unmount is a no-op, so the permission effect (the only startListening caller) can never fire.
  it('never registers a listener when permission resolves after unmount', async () => {
    let resolvePermission: (v: 'granted') => void
    const pending = new Promise<'granted'>(res => { resolvePermission = res })
    w['DeviceOrientationEvent'] = class {
      static requestPermission = vi.fn().mockReturnValue(pending)
    }
    const addSpy = vi.spyOn(window, 'addEventListener')
    const { result, unmount } = renderHook(() => useCameraLevel())
    const req = result.current.requestAccess()
    unmount()
    await act(async () => { resolvePermission!('granted'); await req })
    const calls = addSpy.mock.calls.filter(c => c[0] === 'deviceorientation')
    expect(calls).toHaveLength(0)
    addSpy.mockRestore()
  })

  it('removes exactly the listeners it added on unmount', () => {
    w['DeviceOrientationEvent'] = class {} // no requestPermission (non-iOS path)
    const addSpy = vi.spyOn(window, 'addEventListener')
    const removeSpy = vi.spyOn(window, 'removeEventListener')
    const { unmount } = renderHook(() => useCameraLevel())
    unmount()
    const added = addSpy.mock.calls.filter(c => c[0] === 'deviceorientation').length
    const removed = removeSpy.mock.calls.filter(c => c[0] === 'deviceorientation').length
    expect(added).toBe(1)
    expect(removed).toBe(1)
    addSpy.mockRestore()
    removeSpy.mockRestore()
  })
})
