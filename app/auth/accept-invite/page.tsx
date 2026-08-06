'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import AuthFrame from '@/components/AuthFrame'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import { MIN_PASSWORD_LENGTH, validatePasswordReset } from '@/lib/auth/password'

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
        <p className="a-help">
          Verifying your secure invitation…
        </p>
      ) : !hasInviteSession ? (
        <div role="alert">
          <p className="a-help" style={{ marginBottom: '16px' }}>
            This invitation link is invalid, expired, or has already been used.
          </p>
          <Link href="/auth/sign-in" className="a-label" style={{ textDecoration: 'underline' }}>
            Return to sign in
          </Link>
        </div>
      ) : (
        <form onSubmit={handleSubmit} noValidate className="a-form">
          <p className="a-help">
            First choose a password. You will then connect an authenticator app before access is activated.
          </p>
          {error && (
            <p className="a-error" role="alert" aria-live="assertive">
              {error}
            </p>
          )}
          <div className="a-field">
            <label className="a-label" htmlFor="invite_password">Password</label>
            <input
              id="invite_password"
              className="a-input"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="new-password"
              placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
            />
          </div>
          <div className="a-field">
            <label className="a-label" htmlFor="invite_password_confirm">Confirm password</label>
            <input
              id="invite_password_confirm"
              className="a-input"
              type="password"
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              autoComplete="new-password"
            />
          </div>
          <button type="submit" disabled={loading} className="a-primary a-primary--bar" style={{ marginTop: 6 }}>
            {loading ? 'Saving password…' : 'Continue to multi-factor setup'}
          </button>
        </form>
      )}
    </AuthFrame>
  )
}
