'use client'

import { useEffect, useRef, useState } from 'react'
import { Surface } from '@/components/array/Surface'
import {
  TrainingCoachingRelationshipListV1Schema,
  TrainingCoachingRelationshipRevocationV1Schema,
  type TrainingCoachingRelationshipListV1,
  type TrainingCoachingRelationshipRevocationV1,
  type TrainingCoachingRelationshipV1,
} from '@/lib/training/contracts/coaching-relationship'
import styles from './StrengthProgramBuilder.module.css'

export type TrainingCoachingRelationshipsScope =
  | { readonly kind: 'athlete' }
  | { readonly kind: 'coach'; readonly subjectId: string }

export type TrainingCoachingRelationshipsPanelProps = {
  readonly scope: TrainingCoachingRelationshipsScope
  readonly onRelationshipRevoked: (
    receipt: TrainingCoachingRelationshipRevocationV1,
  ) => void | Promise<void>
}

type LoadState = 'loading' | 'ready' | 'blocked' | 'error'
type RevokeState = 'idle' | 'submitting' | 'uncertain' | 'conflict'

const permissionLabels: Record<TrainingCoachingRelationshipV1['permissions'][number], string> = {
  'subject:read': 'View athlete identity',
  'client_link:read': 'View the client connection',
  'profile:read': 'View training profile',
  'profile:write': 'Edit training profile',
  'program:coach_publish': 'Publish assigned programs',
  'session:read': 'View training sessions',
  'set_log:write': 'Correct session logs',
  'session:complete': 'Finish training sessions',
  'history:read': 'View session history',
  'relationship:revoke': 'End this coaching connection',
}

function listUrl(scope: TrainingCoachingRelationshipsScope) {
  return scope.kind === 'athlete'
    ? '/api/training/coaching/relationships'
    : `/api/training/coaching/relationships?subjectId=${encodeURIComponent(scope.subjectId)}`
}

export default function TrainingCoachingRelationshipsPanel({
  scope,
  onRelationshipRevoked,
}: TrainingCoachingRelationshipsPanelProps) {
  const [projection, setProjection] = useState<TrainingCoachingRelationshipListV1 | null>(null)
  const [loadState, setLoadState] = useState<LoadState>('loading')
  const [selected, setSelected] = useState<TrainingCoachingRelationshipV1 | null>(null)
  const [revokeState, setRevokeState] = useState<RevokeState>('idle')
  const [message, setMessage] = useState('')
  const locked = useRef(false)
  const mounted = useRef(true)
  const requestId = useRef<string | null>(null)

  async function load(signal?: AbortSignal, notice = '') {
    if (locked.current) return
    locked.current = true
    setLoadState('loading')
    setSelected(null)
    setRevokeState('idle')
    requestId.current = null
    setMessage(notice)
    try {
      const response = await fetch(listUrl(scope), { signal })
      if (response.status === 401 || response.status === 403) {
        setProjection(null)
        setLoadState('blocked')
        return
      }
      if (!response.ok) throw new Error('Coaching connections could not be loaded.')
      const parsed = TrainingCoachingRelationshipListV1Schema.safeParse(await response.json())
      const expectedRole = scope.kind === 'athlete' ? 'athlete' : 'coach'
      if (!parsed.success || parsed.data.viewerRole !== expectedRole
        || (scope.kind === 'coach' && parsed.data.subjectId !== scope.subjectId)) {
        throw new Error('The coaching connection response could not be verified.')
      }
      setProjection(parsed.data)
      setLoadState('ready')
    } catch (cause) {
      if (signal?.aborted) return
      setProjection(null)
      setLoadState('error')
      setMessage(cause instanceof Error ? cause.message : 'Coaching connections could not be loaded.')
    } finally {
      locked.current = false
    }
  }

  useEffect(() => {
    mounted.current = true
    const controller = new AbortController()
    void Promise.resolve().then(() => {
      if (!controller.signal.aborted) return load(controller.signal)
    })
    return () => {
      mounted.current = false
      controller.abort()
    }
    // The parent must remount when the canonical coach subject changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function confirmRevocation() {
    if (!selected || !selected.canRevoke || selected.status !== 'active' || locked.current) return
    locked.current = true
    setRevokeState('submitting')
    setMessage('')
    const frozenRequestId = requestId.current ?? crypto.randomUUID()
    requestId.current = frozenRequestId
    try {
      const response = await fetch(
        `/api/training/coaching/relationships/${encodeURIComponent(selected.relationshipId)}/revoke`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ requestId: frozenRequestId, expectedRevision: selected.revision }),
        },
      )
      if (!mounted.current) return
      if (response.status === 401 || response.status === 403) {
        setProjection(null)
        setSelected(null)
        setLoadState('blocked')
        return
      }
      if (response.status === 409) {
        requestId.current = null
        setSelected(null)
        setRevokeState('conflict')
        setMessage('This coaching connection changed. Reload the current connections before trying again.')
        return
      }
      if (!response.ok) throw new Error('The outcome could not be confirmed. Retry the same revocation to recover its receipt.')
      const receipt = TrainingCoachingRelationshipRevocationV1Schema.safeParse(await response.json())
      if (!mounted.current) return
      if (!receipt.success
        || receipt.data.requestId !== frozenRequestId
        || receipt.data.relationshipId !== selected.relationshipId
        || receipt.data.subjectId !== selected.subjectId
        || receipt.data.revision !== selected.revision + 1) {
        throw new Error('The revocation receipt could not be verified. Retry the same revocation to recover it.')
      }
      setProjection(current => current ? {
        ...current,
        relationships: current.relationships.filter(item => item.relationshipId !== selected.relationshipId),
      } : current)
      setSelected(null)
      setRevokeState('idle')
      requestId.current = null
      setMessage('Coaching connection ended. Training history is preserved, and no coach-assigned program was converted into a self-directed program.')
      try {
        await onRelationshipRevoked(receipt.data)
      } catch {
        setMessage('Coaching connection ended and training history is preserved. Pending changes could not be cleared on this device; sign out before using it again.')
      }
    } catch (cause) {
      setRevokeState('uncertain')
      setMessage(cause instanceof Error ? cause.message : 'The outcome could not be confirmed. Retry the same revocation to recover its receipt.')
    } finally {
      locked.current = false
    }
  }

  const active = projection?.relationships.filter(relationship => relationship.status === 'active') ?? []
  const ended = projection?.relationships.filter(relationship => relationship.status === 'revoked') ?? []
  return <Surface tier="tile" innerClassName={styles.pendingPanel}>
    <p className="t-overline">Coaching access</p>
    <h2 className="t-title-2">Coaching connections</h2>
    <p className="t-body">Review what a connected coach can do and end an active connection.</p>
    {loadState === 'loading' ? <p role="status" className="t-footnote">Loading coaching connections…</p> : null}
    {loadState === 'blocked' ? <p role="alert" className={styles.error}>You do not have permission to manage these coaching connections.</p> : null}
    {loadState === 'error' ? <div>
      <p role="alert" className={styles.error}>{message}</p>
      <button type="button" className="a-secondary" onClick={() => void load()}>Retry</button>
    </div> : null}
    {loadState === 'ready' ? <>
      {message ? <p role={revokeState === 'uncertain' || revokeState === 'conflict' ? 'alert' : 'status'} className="t-body">{message}</p> : null}
      {revokeState === 'conflict' ? <button type="button" className="a-secondary" onClick={() => void load(undefined, 'Current coaching connections loaded.')}>Reload connections</button> : null}
      {active.length === 0 ? <p className="t-footnote">No active coaching connection.</p> : <div className="app-stack">
        {active.map((relationship, index) => <section key={relationship.relationshipId} aria-labelledby={`coaching-relationship-${index}`} className={styles.entryState}>
          <h3 id={`coaching-relationship-${index}`} className="t-title-2">
            {relationship.counterpartyDisplayLabel
              ?? `${projection?.viewerRole === 'athlete' ? 'Coach name unavailable' : 'Athlete name unavailable'} · connection ${relationship.connectionReference}`}
          </h3>
          <p className="t-caption">Connected <time dateTime={relationship.startedAt}>{new Date(relationship.startedAt).toLocaleDateString()}</time></p>
          <details>
            <summary>Granted access</summary>
            <ul>{relationship.permissions.map(permission => <li key={permission} className="t-caption">{permissionLabels[permission]}</li>)}</ul>
          </details>
          {relationship.canRevoke
            ? <button type="button" className="a-secondary" onClick={() => { requestId.current = null; setSelected(relationship); setRevokeState('idle'); setMessage('') }}>End coaching connection</button>
            : <p className="t-footnote">Only the athlete or a coach with permission can end this connection.</p>}
        </section>)}
      </div>}
      {ended.length > 0 ? <details>
        <summary>Ended connections ({ended.length})</summary>
        <ul>{ended.map(relationship => <li key={relationship.relationshipId} className="t-caption">
          Ended <time dateTime={relationship.endedAt ?? undefined}>{relationship.endedAt ? new Date(relationship.endedAt).toLocaleDateString() : ''}</time>
        </li>)}</ul>
      </details> : null}
      {selected ? <section role="alertdialog" aria-labelledby="end-coaching-heading" aria-describedby="end-coaching-description" className={styles.pendingPanel}>
        <h3 id="end-coaching-heading" className="t-title-2">End this coaching connection?</h3>
        <p id="end-coaching-description" className="t-body">The coach will lose future access, and active coach-assigned training will end. Existing planned sessions and training history stay available to the athlete. This does not create or convert a self-directed program.</p>
        <div className={styles.saveActions}>
          <button type="button" className="a-secondary" disabled={revokeState === 'submitting'} onClick={() => { requestId.current = null; setSelected(null); setRevokeState('idle') }}>Keep connection</button>
          <button type="button" className="a-primary" disabled={revokeState === 'submitting'} onClick={() => void confirmRevocation()}>
            {revokeState === 'submitting' ? 'Ending connection…' : revokeState === 'uncertain' ? 'Retry same revocation' : 'End connection and coach access'}
          </button>
        </div>
      </section> : null}
    </> : null}
  </Surface>
}
