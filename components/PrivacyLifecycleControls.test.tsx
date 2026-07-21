// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import PrivacyLifecycleControls from './PrivacyLifecycleControls'

const clientId = '20000000-0000-4000-8000-000000000001'

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  }))
}

describe('PrivacyLifecycleControls', () => {
  let inventoryGeneration = 1
  let rotationEnabled = true
  afterEach(() => cleanup())

  beforeEach(() => {
    inventoryGeneration = 1
    rotationEnabled = true
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.startsWith('/api/workouts/shares?')) {
        return jsonResponse({ shares: [{
          session_id: '30000000-0000-4000-8000-000000000001',
          assessment_id: '40000000-0000-4000-8000-000000000001',
          created_at: '2026-07-20T00:00:00Z',
          expires_at: '2026-07-27T00:00:00Z',
          revoked_at: null,
          share_generation: inventoryGeneration,
          state: 'active',
        }], next_cursor: null, rotation_enabled: rotationEnabled })
      }
      if (url === '/api/consent/withdraw') return jsonResponse({ status: 'withdrawn', shares_revoked: 1 })
      if (url === '/api/workouts/shares' && init?.method === 'POST') {
        inventoryGeneration = 7
        return jsonResponse({ status: 'rotated', share_link: 'https://fixture.test/s/new-token', share_generation: 7 })
      }
      if (url.startsWith(`/api/clients/${clientId}`)) {
        return jsonResponse({
          status: 'erased', external_deletion_status: 'pending',
          receipt_id: '30000000-0000-4000-8000-000000000001',
        }, 202)
      }
      return jsonResponse({ error: 'unexpected request' }, 500)
    }))
  })

  test('shows inventory and records a confirmed consent withdrawal', async () => {
    const withdrawn = vi.fn()
    render(<PrivacyLifecycleControls clientId={clientId} hasConsent onConsentWithdrawn={withdrawn} onDeleted={vi.fn()} />)

    expect(await screen.findByText('active')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Withdrawal signer name'), { target: { value: 'Morgan Example' } })
    fireEvent.click(screen.getByLabelText(/I confirm the signer asked/i))
    fireEvent.click(screen.getByRole('button', { name: 'Withdraw consent' }))

    await waitFor(() => expect(withdrawn).toHaveBeenCalledOnce())
    expect(fetch).toHaveBeenCalledWith('/api/consent/withdraw', expect.objectContaining({ method: 'POST' }))
  })

  test('rotates a share and exposes the one-time replacement link', async () => {
    render(<PrivacyLifecycleControls clientId={clientId} hasConsent onConsentWithdrawn={vi.fn()} onDeleted={vi.fn()} />)
    await screen.findByText('active')

    fireEvent.click(screen.getByRole('button', { name: 'Rotate' }))

    const link = await screen.findByDisplayValue('https://fixture.test/s/new-token')
    expect(link).toBeTruthy()
    expect(screen.getByText(/old link no longer works/i)).toBeTruthy()
    expect(screen.getByText(/generation 7/i)).toBeTruthy()
  })

  test('keeps inventory and revocation visible but hides rotation when clinical workouts are disabled', async () => {
    rotationEnabled = false
    render(<PrivacyLifecycleControls clientId={clientId} hasConsent onConsentWithdrawn={vi.fn()} onDeleted={vi.fn()} />)

    expect(await screen.findByText('active')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Rotate' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Revoke' })).toBeTruthy()
  })

  test('fails closed when the inventory response omits the rotation capability', async () => {
    vi.mocked(fetch).mockImplementationOnce(() => jsonResponse({
      shares: [{
        session_id: '30000000-0000-4000-8000-000000000001',
        assessment_id: '40000000-0000-4000-8000-000000000001',
        created_at: '2026-07-20T00:00:00Z',
        expires_at: '2026-07-27T00:00:00Z',
        revoked_at: null,
        share_generation: 1,
        state: 'active',
      }],
      next_cursor: null,
    }))
    render(<PrivacyLifecycleControls clientId={clientId} hasConsent onConsentWithdrawn={vi.fn()} onDeleted={vi.fn()} />)

    expect(await screen.findByText('active')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Rotate' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Revoke' })).toBeTruthy()
  })

  test('requires the exact erasure confirmation and surfaces pending cleanup', async () => {
    const deleted = vi.fn()
    render(<PrivacyLifecycleControls clientId={clientId} hasConsent={false} onConsentWithdrawn={vi.fn()} onDeleted={deleted} />)
    await screen.findByText('active')

    const eraseButton = screen.getByRole('button', { name: 'Permanently erase' }) as HTMLButtonElement
    expect(eraseButton.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Type ERASE to confirm'), { target: { value: 'ERASE' } })
    expect(eraseButton.disabled).toBe(false)
    fireEvent.click(eraseButton)

    await waitFor(() => expect(deleted).toHaveBeenCalledWith({
      externalStatus: 'pending', receiptId: '30000000-0000-4000-8000-000000000001',
    }))
  })
})
