import { describe, expect, it, vi } from 'vitest'
import { finishBrowserSignOut } from './finish-sign-out'

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
})
