'use client'

import { useRef, useState } from 'react'
import { Surface } from '@/components/array/Surface'
import {
  ConditioningProgressionAcceptanceV1Schema,
  ConditioningProgressionProjectionV1Schema,
  type ConditioningProgressionProjectionV1,
} from '@/lib/training/contracts/conditioning-progression'
import styles from './StrengthProgramBuilder.module.css'

const holdCopy = {
  source_incomplete_hold: 'Complete two comparable conditioning sessions before increasing duration.',
  effort_unknown_hold: 'Record perceived effort in both sessions before reviewing an increase.',
  effort_above_target_hold: 'The recorded effort supports keeping the current duration.',
  adverse_symptom_hold: 'Reported symptoms need review before increasing duration.',
  modality_changed_recalibration: 'The activity changed. Establish comparable results before increasing duration.',
  no_whole_minute_available_hold: 'The current duration has reached the available progression limit.',
}
type Status = 'idle' | 'loading' | 'ready' | 'accepting' | 'accepted' | 'retry' | 'stale' | 'forbidden'

function ConditioningPanel({ sessionId }: { sessionId: string }) {
  const [projection, setProjection] = useState<ConditioningProgressionProjectionV1 | null>(null)
  const [status, setStatus] = useState<Status>('idle')
  const [error, setError] = useState('')
  const lock = useRef(false)
  const requestId = useRef<string | null>(null)

  async function review() {
    if (lock.current) return
    lock.current = true
    setStatus('loading')
    setError('')
    try {
      const response = await fetch('/api/training/conditioning/progression/proposals', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId }),
      })
      if (!response.ok) throw new Error(response.status === 403
        ? 'You do not have access to review this conditioning session.'
        : 'A conditioning suggestion is unavailable. Your current targets remain in place.')
      const parsed = ConditioningProgressionProjectionV1Schema.safeParse(await response.json())
      if (!parsed.success) throw new Error('The conditioning suggestion could not be verified.')
      setProjection(parsed.data)
      requestId.current = null
      setStatus('ready')
    } catch (cause) {
      setProjection(null)
      setStatus('idle')
      setError(cause instanceof Error ? cause.message : 'The suggestion could not be loaded.')
    } finally { lock.current = false }
  }

  async function accept() {
    if (lock.current || projection?.result.kind !== 'proposal' || projection.result.decision.status !== 'proposed') return
    lock.current = true
    const result = projection.result
    const decision = result.decision
    requestId.current ??= globalThis.crypto.randomUUID()
    setStatus('accepting')
    setError('')
    try {
      const response = await fetch(`/api/training/conditioning/progression/proposals/${encodeURIComponent(result.proposalId)}/accept`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ requestId: requestId.current }),
      })
      if (response.status === 403) { setStatus('forbidden'); return }
      if (response.status === 409) { setStatus('stale'); return }
      if (!response.ok) throw new Error('Acceptance is not confirmed. Retry to check the same request before making another change.')
      const parsed = ConditioningProgressionAcceptanceV1Schema.safeParse(await response.json())
      if (!parsed.success || parsed.data.proposalId !== result.proposalId
        || parsed.data.assignmentId !== decision.assignmentId
        || parsed.data.programRevisionNumber <= decision.baseProgramRevisionNumber
        || parsed.data.policyVersion !== decision.policyVersion
        || JSON.stringify(parsed.data.policyOrigin) !== JSON.stringify(decision.policyOrigin)
        || parsed.data.targetBoutIds.length !== decision.targetBouts.length
        || !decision.targetBouts.every(bout => parsed.data.targetBoutIds.includes(bout.boutId))) {
        throw new Error('The acceptance receipt could not be verified. Retry the same request to confirm its outcome.')
      }
      setStatus('accepted')
    } catch (cause) {
      setStatus('retry')
      setError(cause instanceof Error ? cause.message : 'Acceptance is not confirmed. Retry the same request.')
    } finally { lock.current = false }
  }

  const decision = projection?.result.kind === 'proposal' || projection?.result.kind === 'not_proposed'
    ? projection.result.decision
    : undefined
  return <Surface tier="tile" innerClassName={styles.sessionPlayer}>
    <h3 className="t-title-2">Next conditioning targets</h3>
    <p>Review your saved duration and effort. Future targets change only after you accept a suggestion.</p>
    {error ? <p role="alert" className={styles.error}>{error}</p> : null}
    {status === 'idle' || status === 'stale' ? <button type="button" className="a-secondary" onClick={() => void review()}>{status === 'stale' ? 'Refresh conditioning suggestion' : 'Review conditioning targets'}</button> : null}
    {status === 'loading' ? <p role="status">Reviewing saved conditioning results…</p> : null}
    {projection?.result.kind === 'insufficient_history' ? <p>Complete two comparable conditioning sessions before reviewing an increase. Your current targets remain in place.</p> : null}
    {projection?.result.kind === 'no_pending_targets' ? <p>No later conditioning targets are waiting. Nothing was changed.</p> : null}
    {decision && (decision.executionContext.kind === 'synthetic_simulation' || decision.policyOrigin.kind === 'synthetic_fixture') ? <p className={styles.practiceBanner}>Practice data · Simulation. This suggestion uses a sample policy.</p> : null}
    {decision?.status === 'not_proposed' ? <p>{holdCopy[decision.reason]} Nothing was changed.</p> : null}
    {decision?.status === 'proposed' ? <>
      <p>Two comparable completed sessions support adding {decision.increaseSecondsPerBout / 60} minute{decision.increaseSecondsPerBout === 120 ? 's' : ''} to each of the next two targets.</p>
      <ul>{decision.targetBouts.map((bout, index) => <li key={bout.boutId}>Upcoming bout {index + 1}: {(bout.acceptedDurationSeconds - decision.increaseSecondsPerBout) / 60} → {bout.acceptedDurationSeconds / 60} minutes</li>)}</ul>
      <p>Keep perceived effort at or below {decision.targetEffortMaximum} out of 10. Saved sessions remain unchanged.</p>
      {status === 'ready' || status === 'retry' ? <button type="button" className="a-primary" onClick={() => void accept()}>{status === 'retry' ? 'Retry conditioning acceptance' : 'Accept conditioning targets'}</button> : null}
    </> : null}
    {status === 'accepting' ? <p role="status">Confirming conditioning targets…</p> : null}
    {status === 'accepted' ? <p role="status">Conditioning targets accepted for the two upcoming bouts.</p> : null}
    {status === 'stale' ? <p role="alert">This suggestion is out of date. Review the latest saved results before accepting.</p> : null}
    {status === 'forbidden' ? <p role="alert">You no longer have permission to accept this suggestion.</p> : null}
  </Surface>
}

export default function TrainingConditioningProgressionPanel({ sessionId }: { sessionId: string }) {
  return <ConditioningPanel key={sessionId} sessionId={sessionId} />
}
