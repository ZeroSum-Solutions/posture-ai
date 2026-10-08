import { describe, expect, it, vi } from 'vitest'
import { assignLocationOnce, finishBrowserSignOut } from './finish-sign-out'

describe('finishBrowserSignOut', () => {
  it('navigates only after the offline queue clear has finished', async () => {
    const order: string[] = []
    let finishClear: () => void = () => {}
    const done = finishBrowserSignOut({
      signOut: async () => { order.push('signOut') },
      clearOfflineQueue: () => new Promise<void>(resolve => { finishClear = () => { order.push('cleared'); resolve() } }),
      navigate: () => { order.push('navigate') },
    })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(order).toEqual(['signOut'])
    finishClear()
    await done
    expect(order).toEqual(['signOut', 'cleared', 'navigate'])
  })

  it('still navigates when the clear fails', async () => {
    const navigate = vi.fn()
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    await finishBrowserSignOut({ signOut: async () => {}, clearOfflineQueue: async () => { throw new Error('idb') }, navigate })
    expect(navigate).toHaveBeenCalledOnce()
    error.mockRestore()
  })

  it('leaves the page once, however many sign-out handlers ask', () => {
    const assign = vi.fn()
    assignLocationOnce('/auth/sign-in', { assign })
    assignLocationOnce('/auth/sign-in?reason=signed_out', { assign })
    expect(assign).toHaveBeenCalledTimes(1)
    expect(assign).toHaveBeenCalledWith('/auth/sign-in')
  })

  it('does not assign an unsafe sign-out destination', async () => {
    vi.resetModules()
    const { assignLocationOnce: assignFromFreshPage } = await import('./finish-sign-out')
    const assign = vi.fn()

    assignFromFreshPage('/%0A/evil.example', { assign })

    expect(assign).toHaveBeenCalledWith('/dashboard')
  })
})
