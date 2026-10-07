'use client'

import { useState, type FormEvent } from 'react'
import styles from './StrengthProgramBuilder.module.css'

const PERMISSION_OPTIONS = [
  { value: 'subject:read', label: 'Read athlete identity' },
  { value: 'client_link:read', label: 'Read the client connection' },
  { value: 'profile:read', label: 'Read training profile' },
  { value: 'profile:write', label: 'Edit training profile' },
  { value: 'program:coach_publish', label: 'Publish assigned programs' },
  { value: 'session:read', label: 'Read training sessions' },
  { value: 'set_log:write', label: 'Correct session logs' },
  { value: 'session:complete', label: 'Finish training sessions' },
  { value: 'history:read', label: 'Read session history' },
  { value: 'relationship:revoke', label: 'End the coaching connection' },
] as const

type CoachPermission = typeof PERMISSION_OPTIONS[number]['value']
type Client = { id: string; name: string }
type InvitationRequest = {
  requestId: string
  clientId: string
  clientName: string
  email: string
  permissions: CoachPermission[]
}
type InvitationReceipt = {
  status: 'prepared'
  invitationId: string
  invitationUrl: string
  expiresAt: string
}
type SubmitState =
  | { kind: 'idle' }
  | { kind: 'submitting' }
  | { kind: 'error'; message: string }
  | { kind: 'uncertain'; message: string }
  | { kind: 'prepared'; receipt: InvitationReceipt; clientName: string }

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+$/.test(value)
}

function parseReceipt(value: unknown): InvitationReceipt | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  if (record.status !== 'prepared'
    || typeof record.invitationId !== 'string' || !UUID_PATTERN.test(record.invitationId)
    || typeof record.invitationUrl !== 'string'
    || typeof record.expiresAt !== 'string' || !/(?:Z|[+-]\d{2}:\d{2})$/.test(record.expiresAt)
    || !Number.isFinite(Date.parse(record.expiresAt))) return null
  try {
    const url = new URL(record.invitationUrl)
    const localHttp = url.protocol === 'http:'
      && (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]')
    if (url.protocol !== 'https:' && !localHttp) return null
  } catch {
    return null
  }
  return {
    status: 'prepared',
    invitationId: record.invitationId,
    invitationUrl: record.invitationUrl,
    expiresAt: record.expiresAt,
  }
}

function errorMessage(status: number, value: unknown): string {
  const record = value && typeof value === 'object' ? value as Record<string, unknown> : null
  const code = typeof record?.code === 'string'
    ? record.code
    : typeof record?.error === 'string' ? record.error : null
  if (status === 401) return 'Sign in again before preparing this invitation.'
  if (status === 403 && code === 'mfa_required') return 'Complete multi-factor authentication before preparing this invitation.'
  if (status === 403) return 'Your practitioner account cannot prepare this invitation.'
  if (status === 409 && (code === 'invitation_unavailable' || code === 'invitation_request_conflict')) return 'This athlete already has an active or pending connection. Reload the client before trying again.'
  if (status === 409) return 'This invitation request conflicts with an earlier request. Review the client and try again.'
  if (status === 422) return 'Review the email and permissions before trying again.'
  if (status === 429) return 'Too many invitations were prepared recently. Wait before trying again.'
  return 'The invitation could not be prepared.'
}

export default function CoachAthleteInvitation({ client }: { client: Client }) {
  const [email, setEmail] = useState('')
  const [permissions, setPermissions] = useState<CoachPermission[]>([])
  const [frozenRequest, setFrozenRequest] = useState<InvitationRequest | null>(null)
  const [state, setState] = useState<SubmitState>({ kind: 'idle' })
  const [copyMessage, setCopyMessage] = useState<string | null>(null)
  const fieldsFrozen = state.kind === 'submitting' || state.kind === 'uncertain' || state.kind === 'prepared'

  function togglePermission(permission: CoachPermission) {
    setPermissions(current => current.includes(permission)
      ? current.filter(value => value !== permission)
      : [...current, permission])
  }

  async function prepare(request: InvitationRequest) {
    setState({ kind: 'submitting' })
    const { clientName, ...body } = request
    let response: Response
    try {
      response = await fetch('/api/training/coaching/invitations', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
    } catch {
      setState({
        kind: 'uncertain',
        message: 'The invitation may have been prepared, but the response was lost. Retry the same request to recover it.',
      })
      return
    }
    const responseBody: unknown = await response.json().catch(() => null)
    if (response.status === 201) {
      const receipt = parseReceipt(responseBody)
      if (!receipt) {
        setState({
          kind: 'uncertain',
          message: 'The invitation response could not be verified. Retry the same request to recover it.',
        })
        return
      }
      setState({ kind: 'prepared', receipt, clientName })
      return
    }
    if (response.ok) {
      setState({
        kind: 'uncertain',
        message: 'The invitation response could not be verified. Retry the same request to recover it.',
      })
      return
    }
    if (response.status === 503) {
      setState({
        kind: 'uncertain',
        message: 'The invitation may have been prepared. Retry the same request to recover it.',
      })
      return
    }
    setFrozenRequest(null)
    setState({ kind: 'error', message: errorMessage(response.status, responseBody) })
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (state.kind === 'submitting' || state.kind === 'prepared') return
    if (state.kind === 'uncertain' && frozenRequest) {
      void prepare(frozenRequest)
      return
    }
    const normalizedEmail = email.trim()
    if (!isValidEmail(normalizedEmail)) {
      setState({ kind: 'error', message: 'Enter a valid athlete email.' })
      return
    }
    if (permissions.length === 0) {
      setState({ kind: 'error', message: 'Choose at least one permission.' })
      return
    }
    const request: InvitationRequest = {
      requestId: crypto.randomUUID(),
      clientId: client.id,
      clientName: client.name,
      email: normalizedEmail,
      permissions: PERMISSION_OPTIONS
        .map(option => option.value)
        .filter(permission => permissions.includes(permission)),
    }
    setFrozenRequest(request)
    void prepare(request)
  }

  async function copyInvitationLink() {
    if (state.kind !== 'prepared') return
    try {
      await navigator.clipboard.writeText(state.receipt.invitationUrl)
      setCopyMessage('Invitation link copied.')
    } catch {
      setCopyMessage('Copy is unavailable. Select and copy the invitation link below.')
    }
  }

  if (state.kind === 'prepared') {
    return <section className={styles.pendingPanel} aria-labelledby="invitation-ready-heading">
      <p className="t-overline">Prepared privately</p>
      <h3 id="invitation-ready-heading" className="t-title-2">Invitation ready</h3>
      <p className="t-body">Share this link directly with {state.clientName}. No message was sent automatically.</p>
      <label className="t-body">
        Invitation link
        <input aria-label="Invitation link" readOnly value={state.receipt.invitationUrl} />
      </label>
      <p className="t-caption">Expires <time dateTime={state.receipt.expiresAt}>{new Date(state.receipt.expiresAt).toLocaleString()}</time></p>
      <div className={styles.saveActions}>
        <button type="button" className="a-primary" onClick={() => void copyInvitationLink()}>Copy invitation link</button>
      </div>
      {copyMessage ? <p role="status" className="t-caption">{copyMessage}</p> : null}
    </section>
  }

  return <form className={styles.entryState} onSubmit={submit} noValidate>
    <label className="t-body">
      Athlete email
      <input
        aria-label="Athlete email"
        autoComplete="email"
        disabled={fieldsFrozen}
        inputMode="email"
        onChange={event => setEmail(event.target.value)}
        type="email"
        value={email}
      />
    </label>
    <fieldset className={styles.fieldset} disabled={fieldsFrozen}>
      <legend>Choose what this coach may do after the athlete accepts</legend>
      <div className={styles.fieldGrid}>
        {PERMISSION_OPTIONS.map(option => <label key={option.value} className="t-caption">
          <input
            checked={permissions.includes(option.value)}
            onChange={() => togglePermission(option.value)}
            type="checkbox"
          />
          {option.label}
        </label>)}
      </div>
    </fieldset>
    {state.kind === 'error' || state.kind === 'uncertain'
      ? <p role="alert" className={styles.error}>{state.message}</p>
      : null}
    <div className={styles.saveActions}>
      {state.kind === 'uncertain' && frozenRequest
        ? <button type="button" className="a-primary" onClick={() => void prepare(frozenRequest)}>Retry same invitation request</button>
        : <button type="submit" className="a-primary" disabled={state.kind === 'submitting'}>
          {state.kind === 'submitting' ? 'Preparing invitation…' : 'Prepare invitation'}
        </button>}
    </div>
  </form>
}
