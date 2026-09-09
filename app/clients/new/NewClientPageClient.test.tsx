// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import NewClientPageClient from './NewClientPageClient'
const { push } = vi.hoisted(() => ({ push: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))
afterEach(() => { cleanup(); vi.unstubAllGlobals(); push.mockReset() })
it('returns a newly created client to the capture flow with selection preserved', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ client: { id: 'client-3' } }, { status: 201 })))
  render(<NewClientPageClient operationMode="prototype" returnTo="capture" />)
  expect(screen.getByRole('link', { name: 'Back to scan' }).getAttribute('href')).toBe('/assessments/new')
  fireEvent.change(screen.getByLabelText(/First Name/), { target: { value: 'Taylor' } })
  fireEvent.change(screen.getByLabelText(/Last Name/), { target: { value: 'Jones' } })
  fireEvent.click(screen.getByRole('button', { name: 'Create Client' }))
  await waitFor(() => expect(push).toHaveBeenCalledWith('/assessments/new?client_id=client-3'))
})
