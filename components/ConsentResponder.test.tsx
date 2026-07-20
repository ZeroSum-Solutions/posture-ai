// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

import ConsentResponder from './ConsentResponder'
import { SUBJECT_CONSENT_SNAPSHOT } from './legal-test-fixture'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('ConsentResponder', () => {
  it('submits the exact displayed consent and preserves the accessible success announcement', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    render(<ConsentResponder token="t1" document={SUBJECT_CONSENT_SNAPSHOT} />)
    expect(screen.getByRole('article', { name: 'Consent to Posture Screening' })).toBeTruthy()
    fireEvent.change(screen.getByLabelText(/Type full name/i), { target: { value: 'Jane Doe' } })
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: /Agree & Sign/i }))

    const confirmation = await screen.findByText('Consent recorded')
    expect(confirmation.closest('[role="status"]')).toBeTruthy()
    const request = fetchMock.mock.calls[0][1] as RequestInit
    expect(JSON.parse(String(request.body))).toMatchObject({
      token: 't1',
      legal_document_id: SUBJECT_CONSENT_SNAPSHOT.documentId,
      legal_document_version: SUBJECT_CONSENT_SNAPSHOT.version,
      legal_document_body_sha256: SUBJECT_CONSENT_SNAPSHOT.bodySha256,
    })
  })

  it('disables signing and exposes a stable live error for an unavailable or superseded link', () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    render(<ConsentResponder token="t1" document={null} />)
    expect(screen.getByRole('alert').textContent).toMatch(/unavailable or has been superseded/i)
    expect((screen.getByRole('checkbox') as HTMLInputElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: /Agree & Sign/i }) as HTMLButtonElement).disabled).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('requires confirmation after the document has loaded', async () => {
    vi.stubGlobal('fetch', vi.fn())

    render(<ConsentResponder token="t1" document={SUBJECT_CONSENT_SNAPSHOT} />)
    fireEvent.change(screen.getByLabelText(/Type full name/i), { target: { value: 'Jane Doe' } })
    fireEvent.click(screen.getByRole('button', { name: /Agree & Sign/i }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/read and agree/i))
  })
})
