'use client'

import { useState } from 'react'

import LegalDocumentView from '@/components/LegalDocumentView'
import useLegalDocument from '@/components/useLegalDocument'

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
    <main style={{
      width: '100%',
      maxWidth: 760,
      margin: '0 auto',
      padding: '40px 20px 64px',
    }}>
      <header style={{ marginBottom: 24 }}>
        <p className="app-page-kicker">Practitioner agreement</p>
        <h1 style={{ color: 'var(--text-primary)', fontSize: '1.5rem', marginBottom: 8 }}>
          Review and accept the legal terms
        </h1>
        <p style={{ color: 'var(--text-secondary)', lineHeight: 1.6 }}>
          Read each complete document below. Acceptance is recorded against the exact versions shown.
        </p>
      </header>

      {isLegalLoading && <p role="status" aria-live="polite">Loading required legal documents…</p>}
      {legalError && (
        <div
          role="alert"
          aria-live="assertive"
          style={{
            padding: 12,
            marginBottom: 16,
            border: '1px solid rgba(239,68,68,0.3)',
            borderRadius: 8,
            color: 'var(--danger)',
          }}
        >
          {legalError} Acceptance is disabled until every required document is available.
        </div>
      )}

      <div style={{ display: 'grid', gap: 20 }}>
        {states.map((state) => state.document && (
          <LegalDocumentView
            key={state.document.documentId}
            document={state.document}
            headingLevel={2}
          />
        ))}
      </div>

      <section style={{
        marginTop: 24,
        padding: 20,
        border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: 10,
        background: 'var(--surface)',
      }}>
        <label style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 12,
          cursor: areDocumentsReady ? 'pointer' : 'not-allowed',
          marginBottom: 20,
        }}>
          <input
            type="checkbox"
            checked={accepted}
            disabled={!areDocumentsReady}
            onChange={(event) => setAccepted(event.target.checked)}
            style={{ marginTop: 2, width: 20, height: 20, cursor: 'inherit' }}
          />
          <span style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
            I have read and accept the Terms of Use, Privacy Policy, and Screening Notice versions shown above.
          </span>
        </label>

        {error && (
          <div
            role="alert"
            aria-live="assertive"
            style={{
              background: 'rgba(239,68,68,0.12)',
              border: '1px solid rgba(239,68,68,0.3)',
              borderRadius: 8,
              padding: 12,
              color: 'var(--danger)',
              fontSize: '0.85rem',
              marginBottom: 16,
            }}
          >
            {error}
          </div>
        )}
        <button
          type="button"
          onClick={handleAccept}
          disabled={!accepted || loading || !areDocumentsReady}
          style={{
            width: '100%',
            minHeight: 44,
            padding: 12,
            background: !accepted || loading || !areDocumentsReady
              ? 'rgba(0,152,243,0.3)'
              : 'var(--brand-strong)',
            color: !accepted || loading || !areDocumentsReady ? 'var(--text-secondary)' : '#fff',
            border: 'none',
            borderRadius: 8,
            fontWeight: 600,
            fontSize: '0.95rem',
            cursor: !accepted || loading || !areDocumentsReady ? 'not-allowed' : 'pointer',
          }}
        >
          {loading ? 'Saving…' : 'Accept and Continue'}
        </button>
      </section>
    </main>
  )
}
