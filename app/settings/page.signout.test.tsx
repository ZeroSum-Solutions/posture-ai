// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

// handleSignOut's two failure paths are exactly what this suite guards:
//
//   - Path A: the server call succeeds as a *request* but reports 503 (the provider
//     signout failed, so the httpOnly session cookie is still valid). The browser
//     client's signOut() must NOT be called here — that call is what makes GoTrue
//     broadcast SIGNED_OUT to every other open tab, and broadcasting it while the
//     session is confirmed to still exist is a false "you're safe to walk away"
//     signal on a clinical device.
//   - Path B: fetch() itself rejects (offline/DNS/VPN drop) before the server is ever
//     reached. The native <form action="/api/auth/sign-out" method="POST"> fallback
//     must still fire so the no-JS path keeps working.
const getUser = vi.fn()
const signOut = vi.fn()
const single = vi.fn()
const eq = vi.fn(() => ({ single }))
const select = vi.fn(() => ({ eq }))
const from = vi.fn(() => ({ select }))

vi.mock('@/lib/supabase/client', () => ({
  createSupabaseBrowserClient: () => ({
    auth: { getUser, signOut },
    from,
  }),
}))

const routerPush = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: routerPush }),
}))

import SettingsPage from './page'

function mockFetch(signOutImpl: () => Promise<{ ok: boolean }>) {
  return vi.fn((url: string) => {
    if (url === '/api/settings/organization') {
      return Promise.resolve({ ok: true, json: async () => ({ organization: null }) })
    }
    if (url === '/api/auth/sign-out') {
      return signOutImpl()
    }
    return Promise.reject(new Error(`unexpected fetch: ${url}`))
  })
}

describe('SettingsPage sign-out', () => {
  let submitSpy: ReturnType<typeof vi.spyOn>
  // jsdom's window.location.assign isn't a configurable own property, so it can't be
  // spied on directly (vi.spyOn throws "Cannot redefine property: assign"). Replace the
  // whole location object with a stub instead.
  const assignSpy = vi.fn()

  beforeEach(() => {
    getUser.mockReset().mockResolvedValue({ data: { user: { id: 'practitioner-1' } } })
    signOut.mockReset().mockResolvedValue({ error: null })
    single.mockReset().mockResolvedValue({
      data: { display_name: 'Dr. Test', practice_name: 'Test Practice', logo_storage_path: null },
    })
    routerPush.mockReset()
    assignSpy.mockReset()
    submitSpy = vi.spyOn(HTMLFormElement.prototype, 'submit').mockImplementation(() => {})
    Object.defineProperty(window, 'location', {
      value: { ...window.location, assign: assignSpy },
      writable: true,
      configurable: true,
    })
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    submitSpy.mockRestore()
  })

  // Array v3: Sign Out is a danger row that opens a confirm Dialog
  // (components/ui/Dialog) rather than acting on the first click — clicking
  // the row then its "Yes, sign out" confirm button exercises the same
  // performSignOut() path the old single-click submit button did.
  async function renderSettled() {
    render(<SettingsPage />)
    const row = await screen.findByRole('button', { name: 'Sign Out' })
    fireEvent.click(row)
    return screen.findByRole('button', { name: 'Yes, sign out' })
  }

  it('broadcasts and redirects only after the server confirms the session is revoked', async () => {
    vi.stubGlobal('fetch', mockFetch(async () => ({ ok: true })))
    const confirmButton = await renderSettled()

    fireEvent.click(confirmButton)

    await waitFor(() => expect(signOut).toHaveBeenCalledTimes(1))
    expect(assignSpy).toHaveBeenCalledWith('/auth/sign-in')
    expect(submitSpy).not.toHaveBeenCalled()
  })

  it('does not broadcast a false sign-out when the server reports 503 with the session intact', async () => {
    vi.stubGlobal('fetch', mockFetch(async () => ({ ok: false })))
    const confirmButton = await renderSettled()

    fireEvent.click(confirmButton)

    expect((await screen.findByRole('alert')).textContent).toMatch(/could not sign out/i)
    expect(signOut).not.toHaveBeenCalled()
    expect(assignSpy).not.toHaveBeenCalled()
    expect(submitSpy).not.toHaveBeenCalled()
  })

  it('still attempts the broadcast and falls back to the native form on genuine network failure', async () => {
    vi.stubGlobal('fetch', mockFetch(() => Promise.reject(new Error('network offline'))))
    const confirmButton = await renderSettled()

    fireEvent.click(confirmButton)

    await waitFor(() => expect(submitSpy).toHaveBeenCalledTimes(1))
    expect(signOut).toHaveBeenCalledTimes(1)
    expect(assignSpy).not.toHaveBeenCalled()
  })
})
