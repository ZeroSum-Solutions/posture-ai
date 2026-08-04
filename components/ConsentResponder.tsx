'use client'
import { useEffect, useRef, useState } from 'react'
import LegalDocumentView from './LegalDocumentView'
import { Surface } from '@/components/array/Surface'
import type { LegalSnapshot } from '@/lib/legal/types'
import styles from './ConsentResponder.module.css'

export default function ConsentResponder({
  token,
  document,
}: {
  token: string
  document: LegalSnapshot | null
}) {
  const [name, setName] = useState('')
  const [rel, setRel] = useState('self')
  const [status, setStatus] = useState<'idle' | 'submitting' | 'done' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [confirmed, setConfirmed] = useState(false)
  const doneRef = useRef<HTMLHeadingElement>(null)

  // The success view replaces the whole form subtree; move focus to its heading so
  // assistive tech lands on (and announces) the confirmation.
  useEffect(() => {
    if (status === 'done') doneRef.current?.focus()
  }, [status])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) { setError('Please type the signer’s full name to sign.'); return }
    if (!confirmed) { setError('Confirm that you have read and agree to the consent terms.'); return }
    if (!document) {
      setError('This consent link is unavailable or has been superseded.')
      return
    }
    setStatus('submitting'); setError(null)
    try {
      const res = await fetch('/api/consent/respond', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          signer_name: name.trim(),
          signer_relationship: rel,
          legal_document_id: document.documentId,
          legal_document_version: document.version,
          legal_document_body_sha256: document.bodySha256,
        }),
      })
      if (res.ok) { setStatus('done'); return }
      const j = await res.json().catch(() => ({}))
      setError(j.error || 'Something went wrong.')
      setStatus('error')
    } catch {
      setError('Network error — please try again.')
      setStatus('error')
    }
  }

  if (status === 'done') {
    return (
      <main className="app-screen app-screen-x app-stack" style={{ paddingTop: 40 }} role="status" aria-live="polite">
        <h1 ref={doneRef} tabIndex={-1} className="t-headline">Consent recorded</h1>
        <p className="t-body">
          Thank you. Your consent has been recorded. You can close this page.
        </p>
      </main>
    )
  }

  return (
    <main className="app-screen app-screen-x app-stack" style={{ paddingTop: 40 }}>
      <div>
        <p className="t-kicker">Consent request</p>
        <h1 className="t-headline" style={{ marginTop: 10 }}>Posture Screening Consent</h1>
      </div>

      {!document && (
        <p role="alert" aria-live="assertive" className="a-error">
          This consent link is unavailable or has been superseded. Ask the practitioner to create a new consent request.
        </p>
      )}
      {document && <LegalDocumentView document={document} headingLevel={2} />}

      <Surface tier="feature">
        <form onSubmit={submit} aria-label="Remote consent form" className="a-form">
          {error && document && (
            <p role="alert" className="a-error">{error}</p>
          )}

          <div className="a-field">
            <label className="a-label" htmlFor="signer_relationship">I am signing as</label>
            <select id="signer_relationship" className="a-select" value={rel} onChange={e => setRel(e.target.value)}>
              <option value="self">The person being screened (myself)</option>
              <option value="parent">Parent of the person being screened</option>
              <option value="legal_guardian">Legal guardian of the person being screened</option>
              <option value="other">Other authorized representative</option>
            </select>
          </div>

          <div className="a-field">
            <label className="a-label" htmlFor="signer_name">
              Type full name to sign <span style={{ color: 'var(--review)' }} aria-hidden="true">*</span>
            </label>
            <input
              id="signer_name" className="a-input" type="text" value={name} onChange={e => setName(e.target.value)}
              placeholder="Full legal name"
              required aria-required="true"
            />
          </div>

          <label htmlFor="consent_confirm" className={styles.consentCheck}>
            <input
              id="consent_confirm"
              type="checkbox"
              checked={confirmed}
              disabled={!document}
              onChange={(event) => setConfirmed(event.target.checked)}
              aria-required="true"
            />
            <span className="t-body">I confirm I have read and agree to the exact consent shown above.</span>
          </label>

          <button type="submit" disabled={status === 'submitting' || !document} className="a-primary a-primary--bar">
            {status === 'submitting' ? 'Submitting…' : 'I Agree & Sign'}
          </button>
        </form>
      </Surface>
    </main>
  )
}
