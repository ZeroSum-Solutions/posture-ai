'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import AuthFrame from '@/components/AuthFrame'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import { MIN_PASSWORD_LENGTH, validatePasswordReset } from '@/lib/auth/password'

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  background: 'var(--background)',
  border: '1px solid rgba(255,255,255,0.12)',
  borderRadius: '8px',
  color: 'var(--text-primary)',
  fontSize: '0.9rem',
  boxSizing: 'border-box',
}

export default function AcceptInvitePage() {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [checking, setChecking] = useState(true)
  const [hasInviteSession, setHasInviteSession] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true
    const supabase = createSupabaseBrowserClient()
    supabase.auth.getUser().then(({ data, error: userError }) => {
      if (!mounted) return
      setHasInviteSession(!userError && !!data.user)
      setChecking(false)
    })
    return () => { mounted = false }
  }, [])

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    const validationError = validatePasswordReset(password, confirm)
    if (validationError) {
      setError(validationError)
      return
    }

    setError(null)
    setLoading(true)
    const supabase = createSupabaseBrowserClient()
    const { error: passwordError } = await supabase.auth.updateUser({ password })
    setLoading(false)
    if (passwordError) {
      setError(passwordError.message)
      return
    }

    // Password setup is still AAL1. The MFA page replaces the session with an
    // AAL2 token and only then calls the atomic invitation-completion RPC.
    window.location.assign('/auth/mfa?mode=invite&next=/onboarding')
  }

  return (
    <AuthFrame
      title="Accept practitioner invitation"
      description="Protect your invited account before entering the practitioner workspace."
    >
      {checking ? (
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
          Verifying your secure invitation…
        </p>
      ) : !hasInviteSession ? (
        <div role="alert">
          <p style={{ color: 'var(--text-secondary)', marginBottom: '16px' }}>
            This invitation link is invalid, expired, or has already been used.
          </p>
          <Link href="/auth/sign-in" style={{ color: 'var(--brand)' }}>
            Return to sign in
          </Link>
        </div>
      ) : (
        <form onSubmit={handleSubmit} noValidate>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginBottom: '20px' }}>
            First choose a password. You will then connect an authenticator app before access is activated.
          </p>
          {error && (
            <div
              role="alert"
              aria-live="assertive"
              style={{
                background: 'rgba(239,68,68,0.12)',
                border: '1px solid rgba(239,68,68,0.3)',
                borderRadius: '8px',
                padding: '12px',
                color: 'var(--danger)',
                fontSize: '0.85rem',
                marginBottom: '16px',
              }}
            >
              {error}
            </div>
          )}
          <div style={{ marginBottom: '16px' }}>
            <label htmlFor="invite_password" style={{ display: 'block', color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: '6px' }}>
              Password
            </label>
            <input
              id="invite_password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="new-password"
              placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
              style={inputStyle}
            />
          </div>
          <div style={{ marginBottom: '24px' }}>
            <label htmlFor="invite_password_confirm" style={{ display: 'block', color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: '6px' }}>
              Confirm password
            </label>
            <input
              id="invite_password_confirm"
              type="password"
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              autoComplete="new-password"
              style={inputStyle}
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            style={{
              width: '100%',
              minHeight: '44px',
              border: 0,
              borderRadius: '8px',
              background: loading ? 'rgba(0,152,243,0.5)' : 'var(--brand-strong)',
              color: '#fff',
              fontWeight: 600,
              cursor: loading ? 'not-allowed' : 'pointer',
            }}
          >
            {loading ? 'Saving password…' : 'Continue to multi-factor setup'}
          </button>
        </form>
      )}
    </AuthFrame>
  )
}
