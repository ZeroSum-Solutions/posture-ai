// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

import InPersonConsentForm from './InPersonConsentForm'
import { SUBJECT_CONSENT_SNAPSHOT } from './legal-test-fixture'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('InPersonConsentForm', () => {
  it('shows the full versioned consent before acceptance and submits its exact identity', async () => {
    const onRecorded = vi.fn()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ document: SUBJECT_CONSENT_SNAPSHOT }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response('{}', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
    vi.stubGlobal('fetch', fetchMock)

    render(<InPersonConsentForm clientId="client-1" subjectName="Meagan" onRecorded={onRecorded} />)
    expect(await screen.findByRole('article', { name: 'Consent to Posture Screening' })).toBeTruthy()
    expect(screen.getByText('You may withdraw consent.')).toBeTruthy()
    fireEvent.change(screen.getByLabelText(/Type full name/i), { target: { value: 'Meagan Example' } })
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: 'Record Consent' }))

    await waitFor(() => expect(onRecorded).toHaveBeenCalledOnce())
    const request = fetchMock.mock.calls[1][1] as RequestInit
    expect(JSON.parse(String(request.body))).toMatchObject({
      client_id: 'client-1',
      legal_document_id: SUBJECT_CONSENT_SNAPSHOT.documentId,
      legal_document_version: SUBJECT_CONSENT_SNAPSHOT.version,
      legal_document_body_sha256: SUBJECT_CONSENT_SNAPSHOT.bodySha256,
    })
  })

  it('disables acceptance and announces an error when consent text is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      error: 'Consent is temporarily unavailable.',
      code: 'legal_unavailable',
    }), { status: 503, headers: { 'Content-Type': 'application/json' } })))

    render(<InPersonConsentForm clientId="client-1" subjectName="Meagan" onRecorded={vi.fn()} />)
    expect((await screen.findByRole('alert')).textContent).toContain('Consent is temporarily unavailable.')
    expect((screen.getByRole('checkbox') as HTMLInputElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Record Consent' }) as HTMLButtonElement).disabled).toBe(true)
  })
})
