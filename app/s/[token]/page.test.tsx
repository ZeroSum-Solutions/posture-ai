import { beforeEach, describe, expect, test, vi } from 'vitest'

const state = vi.hoisted(() => ({ workoutsEnabled: true }))
const notFound = vi.hoisted(() => vi.fn(() => { throw new Error('NEXT_NOT_FOUND') }))

vi.mock('next/navigation', () => ({ notFound }))
vi.mock('@/lib/clinical-content/runtime', () => ({
  clinicalContentAccess: () => ({ surfaces: { workouts: state.workoutsEnabled } }),
}))
vi.mock('./ShareTokenClient', () => ({ default: () => null }))

import ShareTokenPage from './page'

describe('public workout share entry', () => {
  beforeEach(() => {
    state.workoutsEnabled = true
    notFound.mockClear()
  })

  test('stops at the server boundary while clinical workouts are disabled', async () => {
    state.workoutsEnabled = false

    await expect(ShareTokenPage({ params: Promise.resolve({ token: 'historical-token' }) }))
      .rejects.toThrow('NEXT_NOT_FOUND')
    expect(notFound).toHaveBeenCalledOnce()
  })

  test('passes the token to the client player for an enabled fixture', async () => {
    const result = await ShareTokenPage({ params: Promise.resolve({ token: 'fixture-token' }) })

    expect(result.props.token).toBe('fixture-token')
    expect(notFound).not.toHaveBeenCalled()
  })
})
