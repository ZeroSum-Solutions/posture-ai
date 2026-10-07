'use client'
import { useEffect, useRef, useState } from 'react'
import LegalDocumentView from './LegalDocumentView'
import ActionBar from '@/components/ui/ActionBar'
import { Banner } from '@/components/ui/Banner'
import { Button } from '@/components/ui/Button'
import { Checkbox } from '@/components/ui/Checkbox'
import { ErrorState } from '@/components/ui/ErrorState'
import { Select } from '@/components/ui/Select'
import { Stepper, type StepperStep } from '@/components/ui/Stepper'
import { TextField } from '@/components/ui/TextField'
import type { LegalSnapshot } from '@/lib/legal/types'
import styles from './ConsentResponder.module.css'

const STEPS: StepperStep[] = [
  { id: 'read', label: 'Read' },
  { id: 'sign', label: 'Sign' },
]

export default function ConsentResponder({
  token,
  document,
}: {
  token: string
  document: LegalSnapshot | null
}) {
  const [stepId, setStepId] = useState<'read' | 'sign'>('read')
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

  async function submit() {
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

  function handleAgree() {
    if (stepId === 'read') {
      setStepId('sign')
      return
    }
    void submit()
  }

  if (status === 'done') {
    return (
      <div className="app-screen app-screen-x app-stack" style={{ paddingTop: 40 }} role="status" aria-live="polite">
        <h1 ref={doneRef} tabIndex={-1} className="t-title-1">Consent recorded</h1>
        <p className="t-body">
          Thank you. Your consent has been recorded. You can close this page.
        </p>
      </div>
    )
  }

  if (!document) {
    return (
      <div className="app-screen app-screen-x" style={{ paddingTop: 40 }}>
        <ErrorState
          variant="page"
          title="This link is unavailable"
          body="This consent link is unavailable or has been superseded. Ask the practitioner to create a new consent request."
        />
      </div>
    )
  }

  return (
    <div className="app-screen app-screen--bar app-screen-x app-stack" style={{ paddingTop: 40 }}>
      <div>
        <p className="t-overline">Consent request</p>
        <h1 className="t-title-1" style={{ marginTop: 10 }}>Posture Screening Consent</h1>
        <Stepper
          steps={STEPS}
          current={stepId}
          onBack={(id) => setStepId(id as 'read' | 'sign')}
          className={styles.stepper}
        />
      </div>

      <LegalDocumentView document={document} headingLevel={2} collapseFingerprint />

      {stepId === 'sign' && (
        <form
          onSubmit={(event) => { event.preventDefault(); void submit() }}
          aria-label="Remote consent form"
          className="app-stack"
        >
          {error && (
            <Banner variant="error">{error}</Banner>
          )}

          <Select
            id="signer_relationship"
            label="I am signing as"
            value={rel}
            onChange={e => setRel(e.target.value)}
          >
            <option value="self">The person being screened (myself)</option>
            <option value="parent">Parent of the person being screened</option>
            <option value="legal_guardian">Legal guardian of the person being screened</option>
            <option value="other">Other authorized representative</option>
          </Select>

          <TextField
            id="signer_name"
            label="Type full name to sign"
            required
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Full legal name"
          />

          <Checkbox
            id="consent_confirm"
            checked={confirmed}
            onChange={(event) => setConfirmed(event.target.checked)}
            label="I confirm I have read and agree to the exact consent shown above."
          />
        </form>
      )}

      <ActionBar>
        <Button
          variant="primary"
          size="lg"
          block
          loading={status === 'submitting'}
          onClick={handleAgree}
          data-testid="consent-agree"
        >
          I agree
        </Button>
      </ActionBar>
    </div>
  )
}
