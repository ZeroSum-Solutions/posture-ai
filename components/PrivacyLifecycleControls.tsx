'use client'

import { useCallback, useEffect, useState } from 'react'
import { Surface } from '@/components/array/Surface'
import styles from './PrivacyLifecycleControls.module.css'

type ShareState = 'active' | 'expired' | 'revoked' | 'inactive'
type Share = {
  session_id: string
  assessment_id: string
  created_at: string
  expires_at: string | null
  revoked_at: string | null
  share_generation: number
  state: ShareState
}

async function responseBody(response: Response) {
  return response.json().catch(() => ({})) as Promise<Record<string, unknown>>
}

export default function PrivacyLifecycleControls({
  clientId,
  hasConsent,
  onConsentWithdrawn,
  onDeleted,
}: {
  clientId: string
  hasConsent: boolean
  onConsentWithdrawn: () => void
  onDeleted: (result: { externalStatus: 'complete' | 'pending'; receiptId: string | null }) => void
}) {
  const [shares, setShares] = useState<Share[]>([])
  const [shareRotationEnabled, setShareRotationEnabled] = useState(false)
  const [sharesError, setSharesError] = useState<string | null>(null)
  const [busyShare, setBusyShare] = useState<string | null>(null)
  const [newLink, setNewLink] = useState<string | null>(null)
  const [signerName, setSignerName] = useState('')
  const [relationship, setRelationship] = useState<'self' | 'parent' | 'legal_guardian' | 'other'>('self')
  const [withdrawReason, setWithdrawReason] = useState<'subject_request' | 'guardian_request' | 'practitioner_correction'>('subject_request')
  const [withdrawConfirmed, setWithdrawConfirmed] = useState(false)
  const [withdrawing, setWithdrawing] = useState(false)
  const [withdrawError, setWithdrawError] = useState<string | null>(null)
  const [erasureReason, setErasureReason] = useState<'subject_request' | 'guardian_request' | 'duplicate_record' | 'practitioner_correction'>('subject_request')
  const [erasePhrase, setErasePhrase] = useState('')
  const [erasing, setErasing] = useState(false)
  const [eraseError, setEraseError] = useState<string | null>(null)

  const loadShares = useCallback(async (signal?: AbortSignal) => {
      const inventory: Share[] = []
      let rotationEnabled = false
      let cursor: number | null = 0
      while (cursor !== null && !signal?.aborted) {
        const response = await fetch(`/api/workouts/shares?client_id=${encodeURIComponent(clientId)}&cursor=${cursor}`, {
          cache: 'no-store', signal,
        })
        const body = await responseBody(response)
        if (!response.ok) throw new Error(typeof body.error === 'string' ? body.error : 'Could not load share links.')
        if (Array.isArray(body.shares)) inventory.push(...body.shares as Share[])
        // Strict true only. Missing or malformed capability data leaves
        // rotation hidden while inventory and revocation remain usable.
        rotationEnabled = rotationEnabled || body.rotation_enabled === true
        cursor = typeof body.next_cursor === 'number' ? body.next_cursor : null
      }
      if (!signal?.aborted) {
        setShares(inventory)
        setShareRotationEnabled(rotationEnabled)
      }
  }, [clientId])

  useEffect(() => {
    const controller = new AbortController()
    // This effect synchronizes server share inventory into component state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadShares(controller.signal)
      .catch((error) => {
        if (error instanceof Error && error.name === 'AbortError') return
        setShareRotationEnabled(false)
        setSharesError('Could not load share-link status. Refresh to try again.')
      })
    return () => controller.abort()
  }, [loadShares])

  async function withdrawConsent(event: React.FormEvent) {
    event.preventDefault()
    setWithdrawError(null)
    if (!signerName.trim() || !withdrawConfirmed) {
      setWithdrawError('Enter the signer name and confirm the withdrawal request.')
      return
    }
    setWithdrawing(true)
    const response = await fetch('/api/consent/withdraw', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        client_id: clientId,
        signer_name: signerName.trim(),
        signer_relationship: relationship,
        reason_code: withdrawReason,
      }),
    }).catch(() => null)
    if (!response) {
      setWithdrawError('Could not record consent withdrawal. Try again.')
      setWithdrawing(false)
      return
    }
    const body = await responseBody(response)
    if (!response.ok) {
      setWithdrawError(typeof body.error === 'string' ? body.error : 'Could not record consent withdrawal.')
      setWithdrawing(false)
      return
    }
    setNewLink(null)
    await loadShares().catch(() => {
      setSharesError('Consent was withdrawn, but share-link status could not be refreshed. Reload this page.')
    })
    setWithdrawing(false)
    onConsentWithdrawn()
  }

  async function mutateShare(sessionId: string, method: 'POST' | 'DELETE') {
    setBusyShare(sessionId)
    setSharesError(null)
    setNewLink(null)
    const response = await fetch('/api/workouts/shares', {
      method, headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ session_id: sessionId }),
    }).catch(() => null)
    if (!response) {
      setSharesError('Could not update the share link. Try again.')
      setBusyShare(null)
      return
    }
    const body = await responseBody(response)
    if (!response.ok) {
      setSharesError(typeof body.error === 'string' ? body.error : 'Could not update the share link.')
      setBusyShare(null)
      return
    }
    if (method === 'DELETE' && (body.status === 'revoked' || body.status === 'already_revoked')) {
      // The mutation response is authoritative for this row. Reflect the
      // terminal state immediately; the full inventory refresh can still
      // reconcile server metadata without making the user wait on a second
      // network round trip for confirmation.
      setShares(current => current.map(share => (
        share.session_id === sessionId ? { ...share, state: 'revoked' } : share
      )))
    }
    await loadShares().catch(() => {
      setSharesError('The share changed, but its current status could not be refreshed. Reload this page.')
    })
    if (method === 'POST' && typeof body.share_link === 'string') setNewLink(body.share_link)
    setBusyShare(null)
  }

  async function eraseClient(event: React.FormEvent) {
    event.preventDefault()
    setEraseError(null)
    if (erasePhrase !== 'ERASE') {
      setEraseError('Type ERASE exactly to confirm permanent deletion.')
      return
    }
    setErasing(true)
    const response = await fetch(`/api/clients/${encodeURIComponent(clientId)}`, {
      method: 'DELETE', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reason_code: erasureReason }),
    }).catch(() => null)
    if (!response) {
      setEraseError('Could not request erasure. Try again.')
      setErasing(false)
      return
    }
    const body = await responseBody(response)
    if (!response.ok && response.status !== 202) {
      setEraseError(typeof body.error === 'string' ? body.error : 'Could not request erasure.')
      setErasing(false)
      return
    }
    const externalStatus = body.external_deletion_status === 'pending' ? 'pending' : 'complete'
    const receiptId = typeof body.receipt_id === 'string' ? body.receipt_id : null
    if (externalStatus === 'pending' && !receiptId) {
      setEraseError('Database erasure completed, but cleanup status is unavailable. Retry this request or contact support.')
      setErasing(false)
      return
    }
    onDeleted({ externalStatus, receiptId })
  }

  return (
    <section aria-labelledby="privacy-lifecycle-heading" className={styles.stack}>
      <Surface tier="feature">
        <h2 id="privacy-lifecycle-heading" className="t-headline" style={{ marginBottom: 6 }}>Privacy controls</h2>
        <p className="t-body" style={{ marginBottom: 18 }}>
          Consent, shared workout links, and permanent erasure are separate actions. Each change is recorded with a controlled reason.
        </p>

        <h3 className="t-headline" style={{ marginBottom: 10 }}>Workout share links</h3>
        {sharesError && <p role="alert" className="a-error">{sharesError}</p>}
        {shares.length === 0 ? (
          <p className="t-body">No workout share links have been created.</p>
        ) : shares.map((share) => (
          <div key={share.session_id} className={styles.shareRow}>
            <div>
              <strong className={styles.shareState}>{share.state}</strong>
              <span className={styles.shareMeta}>
                Created {new Date(share.created_at).toLocaleDateString()} · generation {share.share_generation}
              </span>
            </div>
            <div className={styles.shareActions}>
              {shareRotationEnabled && (
                <button type="button" className="a-secondary" disabled={!hasConsent || busyShare === share.session_id || share.state !== 'active'} onClick={() => mutateShare(share.session_id, 'POST')}>Rotate</button>
              )}
              <button type="button" className="a-secondary" disabled={busyShare === share.session_id || share.state !== 'active'} onClick={() => mutateShare(share.session_id, 'DELETE')}>Revoke</button>
            </div>
          </div>
        ))}
        {newLink && (
          <label className={`a-field ${styles.newLinkField}`}>
            <span className="a-label">New link — copy it now; the old link no longer works.</span>
            <input readOnly value={newLink} onFocus={(event) => event.currentTarget.select()} className="a-input" />
          </label>
        )}
      </Surface>

      {hasConsent && (
        <Surface tier="feature">
          <form onSubmit={withdrawConsent} className="a-form" aria-label="Withdraw consent">
            <h3 className="t-headline" style={{ marginBottom: 6 }}>Withdraw subject consent</h3>
            <p className="t-body" style={{ marginBottom: 8 }}>
              This blocks new captures and immediately revokes every active workout share link. It does not erase the client record.
            </p>
            <select aria-label="Withdrawal reason" className="a-select" value={withdrawReason} onChange={(event) => setWithdrawReason(event.target.value as typeof withdrawReason)}>
              <option value="subject_request">Client requested withdrawal</option>
              <option value="guardian_request">Guardian requested withdrawal</option>
              <option value="practitioner_correction">Practitioner correction</option>
            </select>
            <select aria-label="Withdrawal signer relationship" className="a-select" value={relationship} onChange={(event) => setRelationship(event.target.value as typeof relationship)}>
              <option value="self">Client</option><option value="parent">Parent</option>
              <option value="legal_guardian">Legal guardian</option><option value="other">Authorized representative</option>
            </select>
            <input aria-label="Withdrawal signer name" className="a-input" value={signerName} onChange={(event) => setSignerName(event.target.value)} placeholder="Signer’s full name" />
            <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              <input type="checkbox" checked={withdrawConfirmed} onChange={(event) => setWithdrawConfirmed(event.target.checked)} />
              <span className="t-body">I confirm the signer asked to withdraw consent.</span>
            </label>
            {withdrawError && <p role="alert" className="a-error">{withdrawError}</p>}
            <button type="submit" className="a-primary" disabled={withdrawing}>{withdrawing ? 'Recording…' : 'Withdraw consent'}</button>
          </form>
        </Surface>
      )}

      <Surface tier="feature" className={styles.erasePanel}>
        <form onSubmit={eraseClient} className="a-form" aria-label="Permanently erase client">
          <h3 className="t-headline" style={{ marginBottom: 6, color: 'var(--review)' }}>Permanently erase client</h3>
          <p className="t-body" style={{ marginBottom: 8 }}>
            Irreversible. Screening data is deleted in one database transaction. Stored report files are queued for retry until deletion completes.
          </p>
          <select aria-label="Erasure reason" className="a-select" value={erasureReason} onChange={(event) => setErasureReason(event.target.value as typeof erasureReason)}>
            <option value="subject_request">Client request</option><option value="guardian_request">Guardian request</option>
            <option value="duplicate_record">Duplicate record</option><option value="practitioner_correction">Practitioner correction</option>
          </select>
          <input aria-label="Type ERASE to confirm" className="a-input" value={erasePhrase} onChange={(event) => setErasePhrase(event.target.value)} placeholder="Type ERASE" autoComplete="off" />
          {eraseError && <p role="alert" className="a-error">{eraseError}</p>}
          {/* The system rule is "never a filled red button" (see globals.css) —
              destructiveness reads through the review-tinted panel ring, the
              red heading, and this label color, not a solid fill. */}
          <button type="submit" className="a-secondary" disabled={erasing || erasePhrase !== 'ERASE'} style={{ color: 'var(--review)' }}>{erasing ? 'Erasing…' : 'Permanently erase'}</button>
        </form>
      </Surface>
    </section>
  )
}
