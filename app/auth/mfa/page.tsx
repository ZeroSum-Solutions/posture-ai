'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import AuthFrame from '@/components/AuthFrame'
import Lens from '@/components/ui/Lens'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import { hardNavigate, safeNextPath } from '@/lib/auth/safe-next'
import { Banner } from '@/components/ui/Banner'
import { Button } from '@/components/ui/Button'
import { TextField } from '@/components/ui/TextField'
import { completionMessage, groupSecret } from './mfa-format'
import styles from './page.module.css'

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

type MfaMode = 'invite' | 'athlete-invite' | 'recovery' | 'signin'

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
  const [mode, setMode] = useState<MfaMode>('signin')
  const nextTarget = useRef('/dashboard')
  const started = useRef(false)
  const initializing = useRef(false)

  const completeAdmission = useCallback(async (admissionMode: MfaMode) => {
    // Password recovery needs the AAL2 session before updateUser. Complete
    // admission only after the password has changed and this page returns.
    if (admissionMode === 'recovery' && nextTarget.current === '/auth/update-password') {
      hardNavigate(nextTarget.current)
      return true
    }

    let response: Response
    try {
      response = await fetch(
        admissionMode === 'athlete-invite'
          ? '/api/training/auth/complete-invitation'
          : '/api/auth/complete-invitation', {
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

    hardNavigate(nextTarget.current)
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
      const normalizedMode: MfaMode =
        requestedMode === 'invite' || requestedMode === 'athlete-invite' || requestedMode === 'recovery'
          ? requestedMode
          : 'signin'
      setMode(normalizedMode)

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
        await completeAdmission(normalizedMode)
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

    // challengeAndVerify saves a replacement AAL2 session. Recovery returns
    // to the password form first; other paths complete admission on the server.
    const completed = await completeAdmission(mode)
    if (!completed) setSubmitting(false)
  }

  const recoveryCopy = mode === 'recovery'
    ? 'Password recovery does not bypass MFA. Verify your existing authenticator, or contact your beta administrator if the factor was lost.'
    : null

  return (
    <AuthFrame
      title={phase === 'enroll' ? 'Connect an authenticator app' : 'Verify multi-factor authentication'}
      description={phase === 'challenge'
        ? 'Enter the current code from the authenticator app already connected to your account.'
        : phase === 'enroll'
          ? 'Connect an authenticator app, then enter the 6-digit code it shows.'
          : 'A second factor is required for every protected session.'}
    >
      {recoveryCopy && (
        <Banner variant="info" className="app-stack" data-testid="mfa-recovery-note">{recoveryCopy}</Banner>
      )}

      {phase === 'loading' && (
        <p className="t-callout" role="status" style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-12)', margin: 0 }}>
          <Lens size={28} state="loading" tone="ghost" />
          Checking your account security…
        </p>
      )}

      {phase === 'error' && (
        <div className="app-stack">
          <Banner variant="error" data-testid="mfa-error">{error}</Banner>
          <Button variant="secondary" size="lg" block onClick={() => void initialize()}>
            Try again
          </Button>
          <Link
            href="/auth/sign-in"
            className="t-callout"
            style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 48, textDecoration: 'none', color: 'var(--ink-1)' }}
          >
            Return to sign in
          </Link>
        </div>
      )}

      {(phase === 'enroll' || phase === 'challenge') && factorId && (
        <form onSubmit={handleVerify} noValidate className="app-stack">
          {phase === 'enroll' && (
            <div className="app-stack">
              {/* The one-tap path, and the only one that works when this page and
                  the authenticator are on the same phone: the otpauth: scheme is
                  registered by Google Authenticator, 1Password, Authy and Duo, so
                  the app opens already holding this account. */}
              {otpauthUri && (
                <Button href={otpauthUri} variant="secondary" size="lg" block>
                  Open in your authenticator app
                </Button>
              )}

              {secret && (
                <div>
                  <p className="t-micro" style={{ marginBottom: 'var(--s-8)' }}>Or enter this setup key</p>
                  <p className={`t-body n ${styles.setupKey}`}>
                    {groupSecret(secret)}
                  </p>
                  <Button variant="secondary" size="sm" style={{ marginTop: 'var(--s-8)' }} onClick={() => void handleCopySecret()}>
                    Copy setup key
                  </Button>
                  <span role="status" aria-live="polite" className="t-footnote" style={{ color: 'var(--text-3)' }}>
                    {copied ? ' Copied to clipboard.' : ''}
                  </span>
                  <p className="t-footnote" style={{ marginTop: 'var(--s-4)', color: 'var(--text-3)' }}>
                    In your authenticator app choose to add an account manually, then paste this key.
                  </p>
                </div>
              )}

              {qrCode && (
                <details>
                  <summary className={`t-footnote ${styles.summary}`} style={{ color: 'var(--text-2)' }}>
                    Setting up from a different device? Show QR code
                  </summary>
                  {/* Supabase returns a short-lived data URL; it is never persisted. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={qrCode}
                    alt="QR code for Posture AI authenticator setup"
                    width={220}
                    height={220}
                    className={styles.qrImage}
                  />
                </details>
              )}
            </div>
          )}

          {error && <Banner variant="error" data-testid="mfa-verify-error">{error}</Banner>}

          <TextField
            id="mfa_code"
            label="Authenticator code"
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
            controlClassName={styles.codeInput}
          />

          <Button type="submit" variant="primary" size="lg" block loading={submitting}>
            Verify and continue
          </Button>
        </form>
      )}
    </AuthFrame>
  )
}
