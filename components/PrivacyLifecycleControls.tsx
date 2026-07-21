'use client'

import { useCallback, useEffect, useState } from 'react'

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

const inputStyle: React.CSSProperties = {
  width: '100%', minHeight: 44, boxSizing: 'border-box', padding: '10px 12px',
  borderRadius: 8, border: '1px solid rgba(255,255,255,0.14)',
  background: 'var(--background)', color: 'var(--text-primary)', fontSize: '0.86rem',
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
      let cursor: number | null = 0
      while (cursor !== null && !signal?.aborted) {
        const response = await fetch(`/api/workouts/shares?client_id=${encodeURIComponent(clientId)}&cursor=${cursor}`, {
          cache: 'no-store', signal,
        })
        const body = await responseBody(response)
        if (!response.ok) throw new Error(typeof body.error === 'string' ? body.error : 'Could not load share links.')
        if (Array.isArray(body.shares)) inventory.push(...body.shares as Share[])
        cursor = typeof body.next_cursor === 'number' ? body.next_cursor : null
      }
      if (!signal?.aborted) setShares(inventory)
  }, [clientId])

  useEffect(() => {
    const controller = new AbortController()
    // This effect synchronizes server share inventory into component state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadShares(controller.signal)
      .catch((error) => {
        if (error instanceof Error && error.name === 'AbortError') return
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
    <section aria-labelledby="privacy-lifecycle-heading" style={{ marginTop: 20, display: 'grid', gap: 16 }}>
      <div className="app-panel" style={{ padding: 20 }}>
        <h2 id="privacy-lifecycle-heading" style={{ margin: '0 0 6px', fontSize: '1rem' }}>Privacy controls</h2>
        <p style={{ margin: '0 0 18px', color: 'var(--text-secondary)', fontSize: '0.84rem', lineHeight: 1.5 }}>
          Consent, shared workout links, and permanent erasure are separate actions. Each change is recorded with a controlled reason.
        </p>

        <h3 style={{ fontSize: '0.92rem', marginBottom: 10 }}>Workout share links</h3>
        {sharesError && <p role="alert" style={{ color: 'var(--danger)', fontSize: '0.82rem' }}>{sharesError}</p>}
        {shares.length === 0 ? (
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.84rem' }}>No workout share links have been created.</p>
        ) : shares.map((share) => (
          <div key={share.session_id} style={{ display: 'flex', gap: 10, justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', padding: '10px 0', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
            <div>
              <strong style={{ textTransform: 'capitalize' }}>{share.state}</strong>
              <span style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', marginLeft: 8 }}>
                Created {new Date(share.created_at).toLocaleDateString()} · generation {share.share_generation}
              </span>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" disabled={!hasConsent || busyShare === share.session_id || share.state !== 'active'} onClick={() => mutateShare(share.session_id, 'POST')}>Rotate</button>
              <button type="button" disabled={busyShare === share.session_id || share.state !== 'active'} onClick={() => mutateShare(share.session_id, 'DELETE')}>Revoke</button>
            </div>
          </div>
        ))}
        {newLink && (
          <label style={{ display: 'block', marginTop: 12, fontSize: '0.82rem' }}>
            New link — copy it now; the old link no longer works.
            <input readOnly value={newLink} onFocus={(event) => event.currentTarget.select()} style={{ ...inputStyle, marginTop: 6 }} />
          </label>
        )}
      </div>

      {hasConsent && (
        <form onSubmit={withdrawConsent} className="app-panel" style={{ padding: 20 }} aria-label="Withdraw consent">
          <h3 style={{ margin: '0 0 6px', fontSize: '0.92rem' }}>Withdraw subject consent</h3>
          <p style={{ margin: '0 0 14px', color: 'var(--text-secondary)', fontSize: '0.84rem', lineHeight: 1.5 }}>
            This blocks new captures and immediately revokes every active workout share link. It does not erase the client record.
          </p>
          <select aria-label="Withdrawal reason" value={withdrawReason} onChange={(event) => setWithdrawReason(event.target.value as typeof withdrawReason)} style={{ ...inputStyle, marginBottom: 10 }}>
            <option value="subject_request">Client requested withdrawal</option>
            <option value="guardian_request">Guardian requested withdrawal</option>
            <option value="practitioner_correction">Practitioner correction</option>
          </select>
          <select aria-label="Withdrawal signer relationship" value={relationship} onChange={(event) => setRelationship(event.target.value as typeof relationship)} style={{ ...inputStyle, marginBottom: 10 }}>
            <option value="self">Client</option><option value="parent">Parent</option>
            <option value="legal_guardian">Legal guardian</option><option value="other">Authorized representative</option>
          </select>
          <input aria-label="Withdrawal signer name" value={signerName} onChange={(event) => setSignerName(event.target.value)} placeholder="Signer’s full name" style={{ ...inputStyle, marginBottom: 10 }} />
          <label style={{ display: 'flex', gap: 8, color: 'var(--text-secondary)', fontSize: '0.82rem', lineHeight: 1.4 }}>
            <input type="checkbox" checked={withdrawConfirmed} onChange={(event) => setWithdrawConfirmed(event.target.checked)} />
            I confirm the signer asked to withdraw consent.
          </label>
          {withdrawError && <p role="alert" style={{ color: 'var(--danger)', fontSize: '0.82rem' }}>{withdrawError}</p>}
          <button type="submit" disabled={withdrawing} style={{ marginTop: 12 }}>{withdrawing ? 'Recording…' : 'Withdraw consent'}</button>
        </form>
      )}

      <form onSubmit={eraseClient} className="app-panel" style={{ padding: 20, borderColor: 'rgba(239,68,68,0.35)' }} aria-label="Permanently erase client">
        <h3 style={{ margin: '0 0 6px', fontSize: '0.92rem', color: 'var(--danger)' }}>Permanently erase client</h3>
        <p style={{ margin: '0 0 14px', color: 'var(--text-secondary)', fontSize: '0.84rem', lineHeight: 1.5 }}>
          Irreversible. Screening data is deleted in one database transaction. Stored report files are queued for retry until deletion completes.
        </p>
        <select aria-label="Erasure reason" value={erasureReason} onChange={(event) => setErasureReason(event.target.value as typeof erasureReason)} style={{ ...inputStyle, marginBottom: 10 }}>
          <option value="subject_request">Client request</option><option value="guardian_request">Guardian request</option>
          <option value="duplicate_record">Duplicate record</option><option value="practitioner_correction">Practitioner correction</option>
        </select>
        <input aria-label="Type ERASE to confirm" value={erasePhrase} onChange={(event) => setErasePhrase(event.target.value)} placeholder="Type ERASE" autoComplete="off" style={{ ...inputStyle, marginBottom: 10 }} />
        {eraseError && <p role="alert" style={{ color: 'var(--danger)', fontSize: '0.82rem' }}>{eraseError}</p>}
        <button type="submit" disabled={erasing || erasePhrase !== 'ERASE'} style={{ color: 'var(--danger)' }}>{erasing ? 'Erasing…' : 'Permanently erase'}</button>
      </form>
    </section>
  )
}
