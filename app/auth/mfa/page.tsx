'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import AuthFrame from '@/components/AuthFrame'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import { safeNextPath } from '@/lib/auth/safe-next'

type Phase = 'loading' | 'enroll' | 'challenge' | 'error'

type FactorLike = {
  id: string
  factor_type: string
  status: string
}

type CompletionBody = {
  ok?: boolean
  code?: string
  error?: string
}

export function completionMessage(code: string | undefined, fallback?: string): string {
  switch (code) {
    case 'expired':
      return 'This invitation has expired. Request a replacement invitation.'
    case 'revoked':
      return 'Practitioner access has been revoked. Contact your beta administrator.'
    case 'not_invited':
    case 'email_mismatch':
      return 'This account does not match an active practitioner invitation.'
    case 'recovery_not_authorized':
      return 'MFA recovery has not been authorized. Contact your beta administrator before trying again.'
    case 'mfa_required':
      return 'The server did not receive the new MFA session. Verify again or reload this page.'
    case 'unauthorized':
      return 'Your secure session has expired. Open the invitation or sign in again.'
    default:
      return fallback || 'Could not activate practitioner access. Please try again.'
  }
}

/**
 * TOTP secrets are base32; authenticator apps accept them with or without
 * spaces. Grouping makes a 32-character key possible to type by hand without
 * losing your place. The clipboard always gets the unspaced original.
 */
export function groupSecret(secret: string): string {
  return secret.replace(/\s+/g, '').replace(/(.{4})/g, '$1 ').trim()
}

export default function MfaPage() {
  const [phase, setPhase] = useState<Phase>('loading')
  const [factorId, setFactorId] = useState<string | null>(null)
  const [qrCode, setQrCode] = useState<string | null>(null)
  const [secret, setSecret] = useState<string | null>(null)
  const [otpauthUri, setOtpauthUri] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [mode, setMode] = useState<'invite' | 'recovery' | 'signin'>('signin')
  const nextTarget = useRef('/dashboard')
  const started = useRef(false)
  const initializing = useRef(false)

  const completeAdmission = useCallback(async () => {
    let response: Response
    try {
      response = await fetch('/api/auth/complete-invitation', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
      })
    } catch {
      setPhase('error')
      setError('Could not reach the access service. Check your connection and try again.')
      return false
    }

    const body = await response.json().catch(() => ({})) as CompletionBody
    if (!response.ok || !body.ok) {
      setPhase('error')
      setError(completionMessage(body.code, body.error))
      return false
    }

    window.location.assign(nextTarget.current)
    return true
  }, [])

  const initialize = useCallback(async () => {
    if (initializing.current) return
    initializing.current = true
    setPhase('loading')
    setError(null)

    try {
      const params = new URLSearchParams(window.location.search)
      nextTarget.current = safeNextPath(params.get('next'))
      const requestedMode = params.get('mode')
      setMode(requestedMode === 'invite' || requestedMode === 'recovery' ? requestedMode : 'signin')

      const supabase = createSupabaseBrowserClient()
      const { data: userData, error: userError } = await supabase.auth.getUser()
      if (userError || !userData.user) {
        setPhase('error')
        setError('Your secure session has expired. Open the invitation or sign in again.')
        return
      }

      const { data: assurance, error: assuranceError } =
        await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
      if (assuranceError || !assurance) {
        setPhase('error')
        setError('Could not verify your session security. Reload the page and try again.')
        return
      }

      if (assurance.currentLevel === 'aal2') {
        await completeAdmission()
        return
      }

      const { data: factorsData, error: factorsError } = await supabase.auth.mfa.listFactors()
      if (factorsError || !factorsData) {
        setPhase('error')
        setError('Could not load your authenticator settings. Try again.')
        return
      }

      const factors = factorsData.all as FactorLike[]
      const verifiedTotp = factors.find(
        (factor) => factor.factor_type === 'totp' && factor.status === 'verified',
      )

      // Supabase does not return the original TOTP secret for an abandoned,
      // unverified factor, so it cannot be safely resumed. Remove only unverified
      // factors before creating one replacement; verified factors are never
      // removed by this self-service flow.
      for (const factor of factors.filter((entry) => entry.status !== 'verified')) {
        const { error: cleanupError } = await supabase.auth.mfa.unenroll({ factorId: factor.id })
        if (cleanupError) {
          setPhase('error')
          setError('Could not reset an incomplete authenticator setup. Try again or contact your beta administrator.')
          return
        }
      }

      if (verifiedTotp) {
        setFactorId(verifiedTotp.id)
        setQrCode(null)
        setSecret(null)
        setOtpauthUri(null)
        setPhase('challenge')
        return
      }

      const { data: enrollment, error: enrollError } = await supabase.auth.mfa.enroll({
        factorType: 'totp',
        friendlyName: 'Posture AI',
      })
      if (enrollError || !enrollment) {
        setPhase('error')
        setError('Could not start authenticator setup. Try again.')
        return
      }

      setFactorId(enrollment.id)
      // All three representations carry the same secret. The QR only works when
      // a second device can photograph this screen, so the otpauth: link and the
      // typed key are what make enrolling on the phone you are reading this on
      // possible at all.
      setQrCode(enrollment.totp.qr_code)
      setSecret(enrollment.totp.secret ?? null)
      setOtpauthUri(enrollment.totp.uri ?? null)
      setPhase('enroll')
    } finally {
      initializing.current = false
    }
  }, [completeAdmission])

  useEffect(() => {
    if (started.current) return
    started.current = true
    void initialize()
  }, [initialize])

  // Clearing through an effect rather than a bare setTimeout keeps the timer from
  // firing into an unmounted component if the code is verified straight after a copy.
  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), 2500)
    return () => window.clearTimeout(timer)
  }, [copied])

  async function handleCopySecret() {
    if (!secret) return
    try {
      await navigator.clipboard.writeText(secret)
      setCopied(true)
    } catch {
      // Clipboard access is refused outside a secure context and on some mobile
      // browsers. The key is on screen either way, so say so instead of failing.
      setError('Could not copy automatically. Select the setup key above and copy it by hand.')
    }
  }

  async function handleVerify(event: React.FormEvent) {
    event.preventDefault()
    if (!factorId || submitting) return
    const normalizedCode = code.replace(/\s/g, '')
    if (!/^\d{6}$/.test(normalizedCode)) {
      setError('Enter the 6-digit code from your authenticator app.')
      return
    }

    setSubmitting(true)
    setError(null)
    const supabase = createSupabaseBrowserClient()
    const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({
      factorId,
      code: normalizedCode,
    })

    if (verifyError) {
      setSubmitting(false)
      setError('That code was not accepted. Wait for a fresh code and try again.')
      return
    }

    // challengeAndVerify saves a replacement AAL2 session. Complete admission
    // on the server, then hard-navigate so proxy and Server Components see it.
    const completed = await completeAdmission()
    if (!completed) setSubmitting(false)
  }

  const recoveryCopy = mode === 'recovery'
    ? 'Password recovery does not bypass MFA. Verify your existing authenticator, or contact your beta administrator if the factor was lost.'
    : null

  return (
    <AuthFrame
      title={phase === 'enroll' ? 'Connect an authenticator app' : 'Verify multi-factor authentication'}
      description="A second factor is required for every practitioner session."
    >
      {recoveryCopy && (
        <p className="a-help" style={{ marginBottom: 18 }}>{recoveryCopy}</p>
      )}

      {phase === 'loading' && (
        <p className="a-help" role="status">Checking your account security…</p>
      )}

      {phase === 'error' && (
        <div className="a-form">
          <p className="a-error" role="alert">{error}</p>
          <button type="button" onClick={() => void initialize()} className="a-secondary a-secondary--bar">
            Try again
          </button>
          <Link href="/auth/sign-in" className="a-help" style={{ textAlign: 'center', textDecoration: 'underline' }}>
            Return to sign in
          </Link>
        </div>
      )}

      {(phase === 'enroll' || phase === 'challenge') && factorId && (
        <form onSubmit={handleVerify} noValidate className="a-form">
          {phase === 'enroll' && (
            <div>
              <p className="a-help">
                Connect an authenticator app, then enter the 6-digit code it shows.
              </p>

              {/* The one-tap path, and the only one that works when this page and
                  the authenticator are on the same phone: the otpauth: scheme is
                  registered by Google Authenticator, 1Password, Authy and Duo, so
                  the app opens already holding this account. */}
              {otpauthUri && (
                <a href={otpauthUri} className="a-primary a-primary--bar" style={{ marginTop: 14 }}>
                  Open in your authenticator app
                </a>
              )}

              {secret && (
                <div style={{ marginTop: 18 }}>
                  <p className="a-label" style={{ marginBottom: 6 }}>Or enter this setup key</p>
                  <p
                    className="n"
                    style={{
                      margin: 0, padding: '10px 12px', borderRadius: 10,
                      background: 'var(--surface-glass)', border: '1px solid var(--hairline)',
                      color: 'var(--text-primary)', fontSize: 15, letterSpacing: '0.08em',
                      wordBreak: 'break-all', userSelect: 'all',
                    }}
                  >
                    {groupSecret(secret)}
                  </p>
                  <button
                    type="button"
                    onClick={() => void handleCopySecret()}
                    className="a-secondary"
                    style={{ marginTop: 8 }}
                  >
                    Copy setup key
                  </button>
                  <span role="status" aria-live="polite" className="a-help">
                    {copied ? ' Copied to clipboard.' : ''}
                  </span>
                  <p className="a-help" style={{ marginTop: 6 }}>
                    In your authenticator app choose to add an account manually, then paste this key.
                  </p>
                </div>
              )}

              {qrCode && (
                <details style={{ marginTop: 18 }}>
                  <summary className="a-help" style={{ cursor: 'pointer' }}>
                    Setting up from a different device? Show QR code
                  </summary>
                  {/* Supabase returns a short-lived data URL; it is never persisted. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={qrCode}
                    alt="QR code for Posture AI authenticator setup"
                    width={220}
                    height={220}
                    style={{
                      display: 'block', maxWidth: '100%', margin: '14px auto',
                      background: '#fff', padding: 8, borderRadius: 12,
                    }}
                  />
                </details>
              )}
            </div>
          )}

          {phase === 'challenge' && (
            <p className="a-help">
              Enter the current code from the authenticator app already connected to your account.
            </p>
          )}

          {error && <p className="a-error" role="alert" aria-live="assertive">{error}</p>}

          <div className="a-field">
            <label className="a-label" htmlFor="mfa_code">Authenticator code</label>
            <input
              id="mfa_code"
              className="a-input n"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="000000"
              // The page exists to collect this one value, and the code expires
              // on a 30s window, so the caret starts here rather than making a
              // keyboard or screen-reader user tab to the only field present.
              autoFocus
              // 7, not 6: authenticators show "123 456" and handleVerify strips
              // whitespace before validating. See page.test.tsx.
              maxLength={7}
              style={{ letterSpacing: '0.16em' }}
            />
          </div>

          <button type="submit" disabled={submitting} className="a-primary a-primary--bar">
            {submitting ? 'Verifying…' : 'Verify and continue'}
          </button>
        </form>
      )}
    </AuthFrame>
  )
}
