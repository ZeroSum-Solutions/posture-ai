'use client'

import { useRef, useState } from 'react'
import { Surface } from '@/components/array/Surface'
import { getTrainingOfflineBrowserOutbox } from '@/lib/training/offline'
import { eraseTrainingSubject } from './TrainingSubjectErasure.gateway'
import styles from './TrainingSubjectErasure.module.css'

const CONFIRMATION = 'ERASE MY TRAINING'

type Stage = 'idle' | 'erasing' | 'retry_server' | 'retry_cleanup' | 'done'

export default function TrainingSubjectErasure({
  userId,
  subjectId,
  createRequestId = () => globalThis.crypto.randomUUID(),
}: {
  userId: string
  subjectId: string
  createRequestId?: () => string
}) {
  const [confirmed, setConfirmed] = useState(false)
  const [phrase, setPhrase] = useState('')
  const [stage, setStage] = useState<Stage>('idle')
  const [error, setError] = useState<string | null>(null)
  const requestId = useRef<string | null>(null)
  const isBusy = stage === 'erasing'

  async function clearDeviceQueue() {
    try {
      await getTrainingOfflineBrowserOutbox().activateUser(null)
      setStage('done')
      setError(null)
    } catch {
      setStage('retry_cleanup')
      setError('Server data is erased, but pending changes could not be cleared from this device.')
    }
  }

  async function erase() {
    if (isBusy || !confirmed || phrase !== CONFIRMATION) return
    setStage('erasing')
    setError(null)
    requestId.current ??= createRequestId()
    try {
      const outbox = getTrainingOfflineBrowserOutbox()
      await outbox.activateUser(userId)
      await eraseTrainingSubject({ requestId: requestId.current, expectedSubjectId: subjectId })
      await clearDeviceQueue()
    } catch (cause) {
      const retryable = typeof cause === 'object' && cause !== null && 'canRetryExact' in cause && cause.canRetryExact === true
      setStage(retryable ? 'retry_server' : 'idle')
      setError(cause instanceof Error ? cause.message : 'Permanent erasure was not confirmed.')
    }
  }

  if (stage === 'done') {
    return <Surface tier="feature"><div className={styles.stack}>
      <h2 className="t-headline">Training data erased</h2>
      <p role="status" className={styles.success}>Your training data was permanently erased, and pending changes were cleared from this device.</p>
      <p className="t-body">Your practitioner’s separate legacy client record was not changed.</p>
    </div></Surface>
  }

  return <div className={styles.stack}>
    <Surface tier="feature"><div className={styles.summary}>
      <h2 className="t-headline">Permanently erase training data</h2>
      <p className="t-body">This removes your athlete training workspace and cannot be undone.</p>
      <ul>
        <li>Programs, session prescriptions, saved actuals, eligibility answers, profiles, and pending changes on this device are removed.</li>
        <li>Your practitioner’s separate legacy client record remains. Contact the practitioner separately to manage that record.</li>
      </ul>
    </div></Surface>
    <section className={styles.danger} aria-labelledby="training-erasure-confirmation">
      <h3 id="training-erasure-confirmation" className="t-headline">Confirm permanent erasure</h3>
      <label className={styles.confirm}>
        <input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />
        <span>I understand this will remove my saved programs, training history, eligibility answers, and pending changes.</span>
      </label>
      <label className={styles.field}>
        <span>Type <strong>{CONFIRMATION}</strong> to confirm</span>
        <input className="a-input" value={phrase} onChange={event => setPhrase(event.target.value)} aria-label="Type ERASE MY TRAINING to confirm" autoComplete="off" />
      </label>
      {error ? <p role="alert" className={styles.error}>{error}</p> : null}
      <div className={styles.actions}>
        {stage === 'retry_cleanup'
          ? <button type="button" className="a-secondary" onClick={() => void clearDeviceQueue()}>Retry device cleanup</button>
          : <button type="button" className="a-secondary" disabled={isBusy || !confirmed || phrase !== CONFIRMATION} onClick={() => void erase()}>
            {isBusy ? 'Erasing…' : stage === 'retry_server' ? 'Retry permanent erasure' : 'Permanently erase my training'}
          </button>}
      </div>
    </section>
  </div>
}
