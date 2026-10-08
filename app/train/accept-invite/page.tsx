'use client'

import { useEffect, useState } from 'react'
import AuthFrame from '@/components/AuthFrame'
import { Banner, Button, TextField } from '@/components/ui'
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
      description="Choose a password, then connect an authenticator before training access is activated."
    >
      {checking ? (
        <p className="t-footnote" role="status">Verifying your secure invitation…</p>
      ) : !hasInviteSession ? (
        <div className="a-form">
          <Banner variant="error">
            This invitation link is invalid, expired, or has already been used.
          </Banner>
          <Button href="/auth/sign-in" variant="tertiary">Return to sign in</Button>
        </div>
      ) : (
        <form onSubmit={handleSubmit} noValidate className="a-form">
          {error && <Banner variant="error">{error}</Banner>}
          <TextField
            label="Password"
            id="athlete_invite_password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="new-password"
            placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
          />
          <TextField
            label="Confirm password"
            id="athlete_invite_password_confirm"
            type="password"
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
            autoComplete="new-password"
          />
          <Button type="submit" size="lg" block loading={loading}>
            Continue to multi-factor setup
          </Button>
        </form>
      )}
    </AuthFrame>
  )
}
