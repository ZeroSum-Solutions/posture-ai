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

export default function MfaPage() {
  const [phase, setPhase] = useState<Phase>('loading')
  const [factorId, setFactorId] = useState<string | null>(null)
  const [qrCode, setQrCode] = useState<string | null>(null)
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
      setQrCode(enrollment.totp.qr_code)
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
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', lineHeight: 1.6, marginBottom: '18px' }}>
          {recoveryCopy}
        </p>
      )}

      {phase === 'loading' && (
        <p role="status" style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
          Checking your account security…
        </p>
      )}

      {phase === 'error' && (
        <div>
          <div role="alert" style={{ color: 'var(--danger)', marginBottom: '18px', lineHeight: 1.5 }}>
            {error}
          </div>
          <button type="button" onClick={() => void initialize()} style={{ minHeight: '44px', marginRight: '14px' }}>
            Try again
          </button>
          <Link href="/auth/sign-in" style={{ color: 'var(--brand)' }}>
            Return to sign in
          </Link>
        </div>
      )}

      {(phase === 'enroll' || phase === 'challenge') && factorId && (
        <form onSubmit={handleVerify} noValidate>
          {phase === 'enroll' && qrCode && (
            <div style={{ marginBottom: '20px' }}>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', lineHeight: 1.6 }}>
                Scan this QR code with your authenticator app, then enter the current 6-digit code.
              </p>
              {/* Supabase returns a short-lived data URL; it is never persisted. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={qrCode}
                alt="QR code for Posture AI authenticator setup"
                width={220}
                height={220}
                style={{ display: 'block', maxWidth: '100%', margin: '16px auto', background: '#fff', padding: '8px', borderRadius: '8px' }}
              />
            </div>
          )}

          {phase === 'challenge' && (
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', lineHeight: 1.6 }}>
              Enter the current code from the authenticator app already connected to your account.
            </p>
          )}

          {error && (
            <div role="alert" aria-live="assertive" style={{ color: 'var(--danger)', margin: '14px 0' }}>
              {error}
            </div>
          )}

          <label htmlFor="mfa_code" style={{ display: 'block', color: 'var(--text-secondary)', fontSize: '0.85rem', margin: '16px 0 6px' }}>
            Authenticator code
          </label>
          <input
            id="mfa_code"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="000000"
            maxLength={7}
            style={{
              width: '100%',
              boxSizing: 'border-box',
              padding: '11px 12px',
              borderRadius: '8px',
              border: '1px solid rgba(255,255,255,0.12)',
              background: 'var(--background)',
              color: 'var(--text-primary)',
              fontSize: '1rem',
              letterSpacing: '0.16em',
              marginBottom: '16px',
            }}
          />
          <button
            type="submit"
            disabled={submitting}
            style={{
              width: '100%',
              minHeight: '44px',
              border: 0,
              borderRadius: '8px',
              background: submitting ? 'rgba(0,152,243,0.5)' : 'var(--brand-strong)',
              color: '#fff',
              fontWeight: 600,
              cursor: submitting ? 'not-allowed' : 'pointer',
            }}
          >
            {submitting ? 'Verifying…' : 'Verify and continue'}
          </button>
        </form>
      )}
    </AuthFrame>
  )
}
