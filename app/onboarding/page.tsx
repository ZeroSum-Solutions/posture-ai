'use client'

import { useState } from 'react'

import LegalDocumentView from '@/components/LegalDocumentView'
import useLegalDocument from '@/components/useLegalDocument'
import { Surface } from '@/components/array/Surface'
import styles from './OnboardingPage.module.css'

export default function OnboardingPage() {
  const [accepted, setAccepted] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const terms = useLegalDocument('terms')
  const privacy = useLegalDocument('privacy')
  const screeningNotice = useLegalDocument('screening_notice')

  const states = [terms, privacy, screeningNotice]
  const isLegalLoading = states.some((state) => state.isLoading)
  const legalError = states.find((state) => state.error)?.error ?? null
  const areDocumentsReady = states.every((state) => state.document !== null)

  async function handleAccept() {
    if (!accepted || loading || !areDocumentsReady) return
    setLoading(true)
    setError(null)
    try {
      const response = await fetch('/api/legal/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          documents: states.map((state) => ({
            document_id: state.document!.documentId,
            body_sha256: state.document!.bodySha256,
          })),
        }),
      })
      const body: unknown = await response.json().catch(() => null)
      if (!response.ok) {
        const message = body && typeof body === 'object' && 'error' in body
          && typeof body.error === 'string'
          ? body.error
          : 'Could not save your legal acceptance. Please try again.'
        throw new Error(message)
      }
      // Hard navigation forces server-side gates to read the newly persisted acceptance.
      window.location.assign('/dashboard')
    } catch (caught) {
      setError(caught instanceof Error
        ? caught.message
        : 'Could not save your legal acceptance. Please try again.')
      setLoading(false)
    }
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <p className="t-overline" style={{ marginBottom: 10 }}>Practitioner agreement</p>
        <h1 className="t-title-1">Review and accept the legal terms</h1>
        <p className="t-body" style={{ marginTop: 8 }}>
          Read each complete document below. Acceptance is recorded against the exact versions shown.
        </p>
      </header>

      {isLegalLoading && <p role="status" aria-live="polite" className="t-body">Loading required legal documents…</p>}
      {legalError && (
        <p role="alert" aria-live="assertive" className="a-error" style={{ marginBottom: 16 }}>
          {legalError} Acceptance is disabled until every required document is available.
        </p>
      )}

      <div className={styles.documents}>
        {states.map((state) => state.document && (
          <LegalDocumentView
            key={state.document.documentId}
            document={state.document}
            headingLevel={2}
          />
        ))}
      </div>

      <Surface tier="feature" style={{ marginTop: 24 }}>
        <label htmlFor="accept_terms" className={styles.acceptRow} data-disabled={!areDocumentsReady || undefined} style={{ marginBottom: 20 }}>
          <input
            id="accept_terms"
            type="checkbox"
            checked={accepted}
            disabled={!areDocumentsReady}
            onChange={(event) => setAccepted(event.target.checked)}
          />
          <span className="t-body">
            I have read and accept the Terms of Use, Privacy Policy, and Screening Notice versions shown above.
          </span>
        </label>

        {error && (
          <p role="alert" aria-live="assertive" className="a-error" style={{ marginBottom: 16 }}>
            {error}
          </p>
        )}
        <button
          type="button"
          onClick={handleAccept}
          disabled={!accepted || loading || !areDocumentsReady}
          className="a-primary a-primary--bar"
        >
          {loading ? 'Saving…' : 'Accept and Continue'}
        </button>
      </Surface>
    </div>
  )
}
