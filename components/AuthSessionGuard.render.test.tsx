// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Guard from './AuthSessionGuard'

const auth = vi.hoisted(() => ({
  listener: null as ((event: string, session: { user: { id: string } } | null) => void) | null,
  synchronize: vi.fn(async () => {}), unsubscribe: vi.fn(),
}))
vi.mock('@/lib/supabase/client', () => ({ createSupabaseBrowserClient: () => ({ auth: {
  onAuthStateChange: (callback: typeof auth.listener) => { auth.listener = callback; return { data: { subscription: { unsubscribe: auth.unsubscribe } } } },
} }) }))
vi.mock('@/lib/training/offline', () => ({
  synchronizeTrainingOfflineAuth: auth.synchronize,
  trainingOfflineAuthState: (event: string, userId: string | null) => event === 'SIGNED_OUT'
    ? { kind: 'signed_out' } : userId ? { kind: 'authenticated', userId } : { kind: 'unknown' },
}))

beforeEach(() => { vi.useFakeTimers(); auth.synchronize.mockClear(); auth.unsubscribe.mockClear() })
afterEach(() => { cleanup(); vi.clearAllTimers(); vi.useRealTimers() })

describe('AuthSessionGuard rendered identity boundary', () => {
  it('removes previous account content before scheduling a navigation, even on the initial auth event', async () => {
    render(<Guard pathname="/train" renderedUserId="athlete-a"><p>Private athlete A results</p></Guard>)
    await act(async () => auth.listener?.('INITIAL_SESSION', { user: { id: 'athlete-b' } }))
    expect(screen.queryByText('Private athlete A results')).toBeNull()
    expect(screen.getByText('Account changed')).toBeTruthy()
    expect(auth.synchronize).toHaveBeenCalledWith({ kind: 'authenticated', userId: 'athlete-b' })
    expect(vi.getTimerCount()).toBeGreaterThan(0)
  })

  it('keeps content on same-user token refresh and unknown transient auth state', async () => {
    render(<Guard pathname="/train" renderedUserId="athlete-a"><p>Private athlete A results</p></Guard>)
    await act(async () => auth.listener?.('TOKEN_REFRESHED', { user: { id: 'athlete-a' } }))
    await act(async () => auth.listener?.('TOKEN_REFRESHED', null))
    expect(screen.getByText('Private athlete A results')).toBeTruthy()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('detects a later direct account switch when no server identity was available on mount', async () => {
    render(<Guard pathname="/train"><p>Private results</p></Guard>)
    await act(async () => auth.listener?.('INITIAL_SESSION', { user: { id: 'athlete-a' } }))
    await act(async () => auth.listener?.('SIGNED_IN', { user: { id: 'athlete-b' } }))
    expect(screen.queryByText('Private results')).toBeNull()
    expect(screen.getByText('Account changed')).toBeTruthy()
  })

  it('does not replace public sign-in content when identity changes', async () => {
    render(<Guard pathname="/auth/sign-in" renderedUserId="athlete-a"><p>Public sign in</p></Guard>)
    await act(async () => auth.listener?.('SIGNED_IN', { user: { id: 'athlete-b' } }))
    expect(screen.getByText('Public sign in')).toBeTruthy()
    expect(screen.queryByText('Account changed')).toBeNull()
  })

  it('keeps the new account after public-to-protected navigation through a persisted root layout', async () => {
    const view = render(<Guard pathname="/auth/sign-in" renderedUserId="athlete-a"><p>Public sign in</p></Guard>)
    await act(async () => auth.listener?.('SIGNED_IN', { user: { id: 'athlete-b' } }))
    view.rerender(<Guard pathname="/train" renderedUserId="athlete-a"><p>Private athlete B results</p></Guard>)
    await act(async () => auth.listener?.('INITIAL_SESSION', { user: { id: 'athlete-b' } }))
    expect(screen.getByText('Private athlete B results')).toBeTruthy()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('owns one navigation timer and cancels it when unmounted', async () => {
    const view = render(<Guard pathname="/train" renderedUserId="athlete-a"><p>Private results</p></Guard>)
    await act(async () => {
      auth.listener?.('SIGNED_OUT', null)
      auth.listener?.('SIGNED_IN', { user: { id: 'athlete-b' } })
    })
    expect(vi.getTimerCount()).toBe(1)
    view.unmount()
    expect(vi.getTimerCount()).toBe(0)
  })
})
