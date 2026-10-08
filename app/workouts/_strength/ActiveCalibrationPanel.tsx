'use client'

import { useRef, useState } from 'react'
import {
  ActiveCalibrationAcceptanceV1Schema,
  ActiveCalibrationProposalProjectionV1Schema,
  type ActiveCalibrationProposalProjectionV1,
} from '@/lib/training/contracts/active-calibration-persistence'
import type { RecoveryContextRecordV1 } from '@/lib/training/contracts/recovery-context'
import { Button } from '@/components/ui'
import ActiveCalibrationChoices, { type CalibrationConfirmation, type CalibrationConfirmationOutcome } from './ActiveCalibrationChoices'

type Props = {
  sessionId: string
  exerciseInstanceId: string
  expected: Pick<RecoveryContextRecordV1, 'subjectId' | 'assignmentId' | 'progressionSeriesId' | 'executionContext'>
}

function Panel({ sessionId, exerciseInstanceId, expected }: Props) {
  const [projection, setProjection] = useState<ActiveCalibrationProposalProjectionV1 | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const loadingRef = useRef(false)

  async function loadOffer() {
    if (loadingRef.current) return
    loadingRef.current = true
    setLoading(true)
    setError('')
    try {
      const response = await fetch('/api/training/active-calibrations/proposals', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId, exerciseInstanceId }),
      })
      const parsed = ActiveCalibrationProposalProjectionV1Schema.safeParse(await response.json().catch(() => null))
      if (!response.ok || !parsed.success) throw new Error('Available settings could not be loaded. Check your training access and try again.')
      const source = parsed.data.offer.sourceBindings
      if (source.subjectId !== expected.subjectId || source.assignmentId !== expected.assignmentId
        || source.priorProgressionSeriesId !== expected.progressionSeriesId
        || JSON.stringify(source.executionContext) !== JSON.stringify(expected.executionContext)) {
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

  async function confirm(input: CalibrationConfirmation): Promise<CalibrationConfirmationOutcome> {
    if (!projection?.proposalId || projection.offer.kind !== 'options') {
      return { status: 'not_accepted', message: 'Load available settings before confirming a change.' }
    }
    const offer = projection.offer
    const selected = offer.options.find(item => item.optionIndex === input.optionIndex)
    if (!selected) return { status: 'not_accepted', message: 'Choose an available setting.' }
    const response = await fetch(`/api/training/active-calibrations/proposals/${encodeURIComponent(projection.proposalId)}/accept`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input),
    })
    const body: unknown = await response.json().catch(() => null)
    if (response.status === 403) return { status: 'not_accepted', message: 'An authorized program owner or assigned coach must confirm this change.' }
    if (response.status === 409 || response.status === 410) return { status: 'not_accepted', message: 'This offer is no longer current. Reload the program before choosing another setting.' }
    const receipt = ActiveCalibrationAcceptanceV1Schema.safeParse(body)
    const selectedLoad = { equipmentId: selected.equipmentId, basis: selected.basis, quantity: selected.quantity }
    if (!response.ok || !receipt.success
      || receipt.data.proposalId !== projection.proposalId
      || receipt.data.assignmentId !== offer.sourceBindings.assignmentId
      || receipt.data.programRevisionNumber !== offer.sourceBindings.sourceProgramRevisionNumber + 1
      || JSON.stringify(receipt.data.executionContext) !== JSON.stringify(offer.sourceBindings.executionContext)
      || JSON.stringify(receipt.data.selectedLoad) !== JSON.stringify(selectedLoad)
      || JSON.stringify(receipt.data.seriesIntent) !== JSON.stringify(offer.seriesIntent)
      || !receipt.data.affectedTargets.some(target => target.sessionId === offer.sourceBindings.target.sessionId
        && target.exerciseInstanceId === offer.sourceBindings.target.exerciseInstanceId)) {
      return { status: 'unconfirmed', message: 'The acceptance receipt could not be verified. Retry the same selection to confirm its outcome.' }
    }
    return { status: 'accepted', message: 'New setting confirmed for future sessions. Reopen the program to see the updated targets.' }
  }

  return <section aria-label="New familiarization">
    {expected.executionContext.kind !== 'live' ? <p>Practice data · Simulation</p> : null}
    {projection ? <ActiveCalibrationChoices offer={projection.offer} onConfirm={confirm} /> : <>
      <Button variant="secondary" size="sm" loading={loading} onClick={() => void loadOffer()}>
        {loading ? 'Loading settings…' : 'Review easier settings'}
      </Button>
      {error ? <p role="alert">{error}</p> : null}
    </>}
  </section>
}

export default function ActiveCalibrationPanel(props: Props) {
  return <Panel key={JSON.stringify(props)} {...props} />
}
