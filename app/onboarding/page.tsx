'use client'

import { useState } from 'react'

import LegalDocumentView from '@/components/LegalDocumentView'
import useLegalDocument from '@/components/useLegalDocument'
import ActionBar from '@/components/ui/ActionBar'
import { Banner } from '@/components/ui/Banner'
import { Button } from '@/components/ui/Button'
import { ErrorState } from '@/components/ui/ErrorState'
import { Skeleton } from '@/components/ui/Skeleton'
import { Stepper, type StepperStep } from '@/components/ui/Stepper'
import styles from './OnboardingPage.module.css'

const STEPS: StepperStep[] = [
  { id: 'terms', label: 'Terms of Use' },
  { id: 'privacy', label: 'Privacy Policy' },
  { id: 'screening_notice', label: 'Screening Notice' },
]

export default function OnboardingPage() {
  const [stepIndex, setStepIndex] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const terms = useLegalDocument('terms')
  const privacy = useLegalDocument('privacy')
  const screeningNotice = useLegalDocument('screening_notice')

  const states = { terms, privacy, screening_notice: screeningNotice }
  const allStates = [terms, privacy, screeningNotice]
  const isLegalLoading = allStates.some((state) => state.isLoading)
  const legalUnavailable = allStates.some((state) => state.error)
  const areDocumentsReady = allStates.every((state) => state.document !== null)

  const currentStep = STEPS[stepIndex]!
  const currentState = states[currentStep.id as keyof typeof states]
  const isLastStep = stepIndex === STEPS.length - 1

  async function handleAccept() {
    if (loading || !areDocumentsReady) return
    if (!isLastStep) {
      setStepIndex((index) => index + 1)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const response = await fetch('/api/legal/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          documents: allStates.map((state) => ({
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

  if (legalUnavailable) {
    return (
      <div className="app-screen app-screen-x">
        <ErrorState
          variant="blocking"
          title="Legal documents unavailable"
          body="Required legal text could not be loaded, so acceptance is disabled. Check your connection and try again."
          onRetry={() => window.location.reload()}
        />
      </div>
    )
  }

  return (
    <div className="app-screen app-screen--bar app-screen-x">
      <header className={styles.header}>
        <p className="t-overline">Practitioner agreement</p>
        <h1 className="t-title-1">Review and accept the legal terms</h1>
        <p className="t-body" style={{ marginTop: 'var(--s-8)', color: 'var(--text-2)' }}>
          Read each document. Acceptance is recorded against the exact versions shown.
        </p>
        <Stepper
          steps={STEPS}
          current={currentStep.id}
          onBack={(id) => setStepIndex(STEPS.findIndex((step) => step.id === id))}
          className={styles.stepper}
        />
      </header>

      <div className={styles.documents}>
        {currentState.isLoading || !currentState.document ? (
          <Skeleton shape="card" />
        ) : (
          <LegalDocumentView
            key={currentState.document.documentId}
            document={currentState.document}
            headingLevel={2}
            collapseFingerprint
          />
        )}
      </div>

      {error && (
        <Banner variant="error" className={styles.error} data-testid="onboarding-accept-error">{error}</Banner>
      )}

      <ActionBar>
        <Button
          variant="primary"
          size="lg"
          block
          loading={loading}
          disabledReason={isLegalLoading ? 'Required legal text is still loading.' : undefined}
          onClick={() => void handleAccept()}
        >
          I agree
        </Button>
      </ActionBar>
    </div>
  )
}
