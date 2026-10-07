// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import ClientForm from './ClientForm'

vi.mock('@/components/useLegalDocument', () => ({
  default: vi.fn(() => ({ document: null, error: 'unavailable', isLoading: false })),
}))
// ActionBar (components/ui) reads the route via usePathname.
vi.mock('next/navigation', () => ({ usePathname: () => '/clients/new' }))

describe('ClientForm prototype operation', () => {
  test('creates a prototype record without rendering or submitting signature evidence', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    render(
      <ClientForm
        mode="create"
        operationMode="prototype"
        cancelHref="/clients"
        onSubmit={onSubmit}
      />,
    )

    expect(screen.queryByLabelText(/Type full name to sign/i)).toBeNull()
    fireEvent.change(screen.getByLabelText(/First Name/i), { target: { value: 'Ada' } })
    fireEvent.change(screen.getByLabelText(/Last Name/i), { target: { value: 'Lovelace' } })
    fireEvent.submit(screen.getByRole('form', { name: 'New client form' }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      first_name: 'Ada',
      last_name: 'Lovelace',
    })))
    expect(onSubmit.mock.calls[0][0]).not.toHaveProperty('signer_name')
    expect(onSubmit.mock.calls[0][0]).not.toHaveProperty('legal_document_id')
  })
})
