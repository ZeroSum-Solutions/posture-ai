'use client'

import { useState } from 'react'
import LegalDocumentView from './LegalDocumentView'
import useLegalDocument from './useLegalDocument'

type SignerRelationship = 'self' | 'parent' | 'legal_guardian' | 'other'

export default function InPersonConsentForm({
  clientId,
  subjectName,
  onRecorded,
  submitLabel = 'Record Consent',
}: {
  clientId: string
  subjectName: string
  onRecorded: () => void | Promise<void>
  submitLabel?: string
}) {
  const [signerName, setSignerName] = useState('')
  const [relationship, setRelationship] = useState<SignerRelationship>('self')
  const [confirmed, setConfirmed] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const legal = useLegalDocument('subject_consent')

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    if (!signerName.trim()) {
      setError('Type the signer’s full name to sign.')
      return
    }
    if (!confirmed) {
      setError('Confirm that the signer has read and agreed to the consent terms.')
      return
    }
    if (!legal.document) {
      setError(legal.error ?? 'Consent terms are unavailable. Acceptance is disabled.')
      return
    }

    setSubmitting(true)
    try {
      const response = await fetch('/api/consent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: clientId,
          signer_name: signerName.trim(),
          signer_relationship: relationship,
          legal_document_id: legal.document.documentId,
          legal_document_version: legal.document.version,
          legal_document_body_sha256: legal.document.bodySha256,
        }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.error || 'Failed to record consent.')
      await onRecorded()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Failed to record consent.')
      setSubmitting(false)
    }
  }

  const inputStyle: React.CSSProperties = {
    width: '100%',
    minHeight: 44,
    boxSizing: 'border-box',
    padding: '10px 12px',
    borderRadius: 8,
    border: '1px solid rgba(255,255,255,0.14)',
    background: 'var(--background)',
    color: 'var(--text-primary)',
    fontSize: '0.9rem',
  }

  return (
    <form
      aria-label="Record in-person consent"
      onSubmit={submit}
      style={{
        marginTop: 16,
        padding: 16,
        borderRadius: 10,
        border: '1px solid rgba(0,152,243,0.3)',
        background: 'rgba(0,152,243,0.08)',
      }}
    >
      <h3 style={{ margin: '0 0 6px', color: 'var(--text-primary)', fontSize: '1rem' }}>
        Record consent for {subjectName}
      </h3>
      <p style={{ margin: '0 0 14px', color: 'var(--text-secondary)', fontSize: '0.84rem', lineHeight: 1.5 }}>
        The client, parent, or legal guardian can review and sign on this device. The camera remains locked until this is complete.
      </p>

      <div style={{ marginBottom: 14 }}>
        {legal.isLoading && <p role="status" aria-live="polite">Loading consent terms…</p>}
        {legal.error && (
          <p role="alert" aria-live="assertive" style={{ color: 'var(--danger)' }}>
            {legal.error}
          </p>
        )}
        {legal.document && <LegalDocumentView document={legal.document} headingLevel={4} compact />}
      </div>

      <label htmlFor={`signer_relationship_${clientId}`} style={{ display: 'block', marginBottom: 6, color: 'var(--text-secondary)', fontSize: '0.84rem' }}>
        Who is giving consent?
      </label>
      <select
        id={`signer_relationship_${clientId}`}
        value={relationship}
        onChange={(event) => setRelationship(event.target.value as SignerRelationship)}
        style={{ ...inputStyle, marginBottom: 14 }}
      >
        <option value="self">The client (self)</option>
        <option value="parent">Parent of the client</option>
        <option value="legal_guardian">Legal guardian of the client</option>
        <option value="other">Other authorized representative</option>
      </select>

      <label htmlFor={`signer_name_${clientId}`} style={{ display: 'block', marginBottom: 6, color: 'var(--text-secondary)', fontSize: '0.84rem' }}>
        Type full name to sign
      </label>
      <input
        id={`signer_name_${clientId}`}
        value={signerName}
        onChange={(event) => setSignerName(event.target.value)}
        placeholder="Signer’s full legal name"
        autoComplete="name"
        style={{ ...inputStyle, marginBottom: 14 }}
      />

      <label htmlFor={`consent_confirm_${clientId}`} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, color: 'var(--text-secondary)', fontSize: '0.84rem', lineHeight: 1.5, cursor: 'pointer' }}>
        <input
          id={`consent_confirm_${clientId}`}
          type="checkbox"
          checked={confirmed}
          disabled={!legal.document}
          onChange={(event) => setConfirmed(event.target.checked)}
          style={{ width: 20, height: 20, marginTop: 1, flexShrink: 0 }}
        />
        <span>I confirm I have read and agree to the posture-screening consent on behalf of the client.</span>
      </label>

      {error && <p role="alert" style={{ margin: '12px 0 0', color: 'var(--danger)', fontSize: '0.84rem' }}>{error}</p>}

      <button
        type="submit"
        disabled={submitting || !legal.document}
        style={{
          width: '100%',
          minHeight: 44,
          marginTop: 16,
          padding: '11px 16px',
          border: 'none',
          borderRadius: 8,
          background: submitting || !legal.document ? 'rgba(0,152,243,0.4)' : 'var(--brand-strong)',
          color: '#fff',
          fontSize: '0.9rem',
          fontWeight: 700,
          cursor: submitting || !legal.document ? 'not-allowed' : 'pointer',
        }}
      >
        {submitting ? 'Recording…' : submitLabel}
      </button>
    </form>
  )
}
