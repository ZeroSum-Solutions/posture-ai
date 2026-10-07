'use client'

import { useRef, useState } from 'react'
import {
  ManualRecalibrationAcceptanceV1Schema,
  ManualRecalibrationProposalProjectionV1Schema,
  type ManualRecalibrationProposalProjectionV1,
} from '@/lib/training/contracts/manual-recalibration-persistence'
import type { TrainingProgressionProjectionV1 } from '@/lib/training/contracts/progression'
import type { ManualRecalibrationOfferV1 } from '@/lib/training/contracts/manual-recalibration'
import { Button } from '@/components/ui'
import ManualRecalibrationChoices, { type ManualCalibrationConfirmation, type ManualCalibrationConfirmationOutcome } from './ManualRecalibrationChoices'

type Props = {
  sessionId: string
  exerciseInstanceId: string
  expected: Extract<TrainingProgressionProjectionV1['result'], { kind: 'not_proposed' }>['target']
  executionContext: ManualRecalibrationOfferV1['sourceBindings']['executionContext']
}

function Panel({ sessionId, exerciseInstanceId, expected, executionContext }: Props) {
  const [projection, setProjection] = useState<ManualRecalibrationProposalProjectionV1 | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const loadingRef = useRef(false)

  async function loadOffer() {
    if (loadingRef.current) return
    loadingRef.current = true
    setLoading(true)
    setError('')
    try {
      const response = await fetch('/api/training/manual-recalibrations/proposals', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId, exerciseInstanceId }),
      })
      const parsed = ManualRecalibrationProposalProjectionV1Schema.safeParse(await response.json().catch(() => null))
      if (!response.ok || !parsed.success) throw new Error('Available settings could not be loaded. Check your training access and try again.')
      const source = parsed.data.offer.sourceBindings
      if (source.assignmentId !== expected.assignmentId
        || source.sourceProgramRevisionNumber !== expected.baseProgramRevisionNumber
        || source.target.sessionId !== expected.sessionId
        || source.target.exerciseInstanceId !== expected.exerciseInstanceId
        || source.sourceDecision.sourceSessionId !== sessionId
        || source.sourceDecision.sourceExerciseInstanceId !== exerciseInstanceId
        || JSON.stringify(source.executionContext) !== JSON.stringify(executionContext)) {
        throw new Error('The settings did not match this exercise and program. Reload the program before continuing.')
      }
      setProjection(parsed.data)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Available settings could not be loaded.')
    } finally {
      loadingRef.current = false
      setLoading(false)
    }
  }

  async function confirm(input: ManualCalibrationConfirmation): Promise<ManualCalibrationConfirmationOutcome> {
    if (!projection?.proposalId || projection.offer.kind !== 'options') {
      return { status: 'not_accepted', message: 'Load available settings before confirming a change.' }
    }
    const offer = projection.offer
    const selected = offer.options.find(item => item.optionIndex === input.optionIndex)
    if (!selected) return { status: 'not_accepted', message: 'Choose an available setting.' }
    const response = await fetch(`/api/training/manual-recalibrations/proposals/${encodeURIComponent(projection.proposalId)}/accept`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input),
    })
    const body: unknown = await response.json().catch(() => null)
    if (response.status === 403) return { status: 'not_accepted', message: 'An authorized program owner or assigned coach must confirm this change.' }
    if (response.status === 409 || response.status === 410) return { status: 'not_accepted', message: 'This offer is no longer current. Reload the program before choosing another setting.' }
    const receipt = ManualRecalibrationAcceptanceV1Schema.safeParse(body)
    const selectedLoad = { equipmentId: selected.equipmentId, basis: selected.basis, quantity: selected.quantity }
    if (!response.ok || !receipt.success
      || receipt.data.proposalId !== projection.proposalId
      || receipt.data.assignmentId !== offer.sourceBindings.assignmentId
      || receipt.data.programRevisionNumber !== offer.sourceBindings.sourceProgramRevisionNumber + 1
      || JSON.stringify(receipt.data.executionContext) !== JSON.stringify(offer.sourceBindings.executionContext)
      || JSON.stringify(receipt.data.selectedLoad) !== JSON.stringify(selectedLoad)
      || JSON.stringify(receipt.data.sourceDecision) !== JSON.stringify(offer.sourceBindings.sourceDecision)
      || receipt.data.outlierAcknowledged !== input.outlierAcknowledged
      || JSON.stringify(receipt.data.seriesIntent) !== JSON.stringify(offer.seriesIntent)
      || !receipt.data.affectedTargets.some(target => target.sessionId === offer.sourceBindings.target.sessionId
        && target.exerciseInstanceId === offer.sourceBindings.target.exerciseInstanceId)) {
      return { status: 'unconfirmed', message: 'The acceptance receipt could not be verified. Retry the same selection to confirm its outcome.' }
    }
    return { status: 'accepted', message: 'New setting confirmed for future sessions. Reopen the program to see the updated targets.' }
  }

  return <section aria-label="Effort-based familiarization">
    {executionContext.kind !== 'live' ? <p>Practice data · Simulation</p> : null}
    {projection ? <ManualRecalibrationChoices offer={projection.offer} onConfirm={confirm} /> : <>
      <Button variant="secondary" size="sm" loading={loading} onClick={() => void loadOffer()}>
        {loading ? 'Loading settings…' : 'Review starting settings'}
      </Button>
      {error ? <p role="alert">{error}</p> : null}
    </>}
  </section>
}

export default function ManualRecalibrationPanel(props: Props) {
  return <Panel key={JSON.stringify(props)} {...props} />
}
