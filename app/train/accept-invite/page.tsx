'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import AuthFrame from '@/components/AuthFrame'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import { MIN_PASSWORD_LENGTH, validatePasswordReset } from '@/lib/auth/password'

export default function AthleteAcceptInvitePage() {
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
    const { error: passwordError } = await createSupabaseBrowserClient().auth.updateUser({ password })
    setLoading(false)
    if (passwordError) {
      setError(passwordError.message)
      return
    }
    window.location.assign('/auth/mfa?mode=athlete-invite&next=/train')
  }

  return (
    <AuthFrame
      title="Accept athlete invitation"
      description="Protect your invited account before opening your training workspace."
    >
      {checking ? (
        <p className="a-help" role="status">Verifying your secure invitation…</p>
      ) : !hasInviteSession ? (
        <div role="alert">
          <p className="a-help" style={{ marginBottom: 16 }}>
            This invitation link is invalid, expired, or has already been used.
          </p>
          <Link href="/auth/sign-in" className="a-label" style={{ textDecoration: 'underline' }}>
            Return to sign in
          </Link>
        </div>
      ) : (
        <form onSubmit={handleSubmit} noValidate className="a-form">
          <p className="a-help">
            Choose a password, then connect an authenticator before training access is activated.
          </p>
          {error && <p className="a-error" role="alert">{error}</p>}
          <div className="a-field">
            <label className="a-label" htmlFor="athlete_invite_password">Password</label>
            <input
              id="athlete_invite_password"
              className="a-input"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="new-password"
              placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
            />
          </div>
          <div className="a-field">
            <label className="a-label" htmlFor="athlete_invite_password_confirm">Confirm password</label>
            <input
              id="athlete_invite_password_confirm"
              className="a-input"
              type="password"
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              autoComplete="new-password"
            />
          </div>
          <button type="submit" disabled={loading} className="a-primary a-primary--bar">
            {loading ? 'Saving password…' : 'Continue to multi-factor setup'}
          </button>
        </form>
      )}
    </AuthFrame>
  )
}
