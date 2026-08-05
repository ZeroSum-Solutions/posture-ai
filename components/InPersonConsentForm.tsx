'use client'

import { useState } from 'react'
import LegalDocumentView from './LegalDocumentView'
import useLegalDocument from './useLegalDocument'
import { Surface } from '@/components/array/Surface'
import styles from './InPersonConsentForm.module.css'

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

  return (
    <Surface tier="tile">
      <form aria-label="Record in-person consent" onSubmit={submit} className="a-form">
        <div>
          <h3 className="t-title">Record consent for {subjectName}</h3>
          <p className="a-help" style={{ marginTop: 4 }}>
            The client, parent, or legal guardian can review and sign on this device. The camera remains locked until this is complete.
          </p>
        </div>

        <div>
          {legal.isLoading && <p role="status" aria-live="polite" className="a-help">Loading consent terms…</p>}
          {legal.error && (
            <p role="alert" aria-live="assertive" className="a-error">
              {legal.error}
            </p>
          )}
          {legal.document && <LegalDocumentView document={legal.document} headingLevel={4} compact />}
        </div>

        <div className="a-field">
          <label className="a-label" htmlFor={`signer_relationship_${clientId}`}>Who is giving consent?</label>
          <select
            id={`signer_relationship_${clientId}`}
            className="a-select"
            value={relationship}
            onChange={(event) => setRelationship(event.target.value as SignerRelationship)}
          >
            <option value="self">The client (self)</option>
            <option value="parent">Parent of the client</option>
            <option value="legal_guardian">Legal guardian of the client</option>
            <option value="other">Other authorized representative</option>
          </select>
        </div>

        <div className="a-field">
          <label className="a-label" htmlFor={`signer_name_${clientId}`}>Type full name to sign</label>
          <input
            id={`signer_name_${clientId}`}
            className="a-input"
            value={signerName}
            onChange={(event) => setSignerName(event.target.value)}
            placeholder="Signer’s full legal name"
            autoComplete="name"
          />
        </div>

        <label htmlFor={`consent_confirm_${clientId}`} className={styles.consentCheck}>
          <input
            id={`consent_confirm_${clientId}`}
            type="checkbox"
            checked={confirmed}
            disabled={!legal.document}
            onChange={(event) => setConfirmed(event.target.checked)}
          />
          <span className="t-body">I confirm I have read and agree to the posture-screening consent on behalf of the client.</span>
        </label>

        {error && <p role="alert" className="a-error">{error}</p>}

        <button
          type="submit"
          disabled={submitting || !legal.document}
          className="a-primary a-primary--bar"
        >
          {submitting ? 'Recording…' : submitLabel}
        </button>
      </form>
    </Surface>
  )
}
