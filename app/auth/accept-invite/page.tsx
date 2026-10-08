'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import AuthFrame from '@/components/AuthFrame'
import Lens from '@/components/ui/Lens'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import { MIN_PASSWORD_LENGTH, validatePasswordReset } from '@/lib/auth/password'
import { Banner } from '@/components/ui/Banner'
import { Button } from '@/components/ui/Button'
import { IconButton } from '@/components/ui/IconButton'
import { TextField } from '@/components/ui/TextField'

export default function AcceptInvitePage() {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPassword, setShowPassword] = useState(false)
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
      description="First choose a password. You will then connect an authenticator app before access is activated."
    >
      {checking ? (
        <p className="t-callout" role="status" style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-12)', margin: 0 }}>
          <Lens size={28} state="loading" tone="ghost" />
          Verifying your secure invitation…
        </p>
      ) : !hasInviteSession ? (
        <Banner variant="error" data-testid="accept-invite-error">
          This invitation link is invalid, expired, or has already been used.
          <Link
            href="/auth/sign-in"
            style={{ display: 'flex', alignItems: 'center', minHeight: 48, marginTop: 'var(--s-4)', color: 'var(--text-1)', textDecoration: 'underline' }}
          >
            Return to sign in
          </Link>
        </Banner>
      ) : (
        <form onSubmit={handleSubmit} noValidate className="app-stack">
          {error && <Banner variant="error" data-testid="accept-invite-password-error">{error}</Banner>}
          <TextField
            id="invite_password"
            label="Password"
            type={showPassword ? 'text' : 'password'}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="new-password"
            placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
            trailing={
              <IconButton
                icon={showPassword ? 'eye-closed-linear' : 'eye-linear'}
                label={showPassword ? 'Hide password' : 'Show password'}
                variant="plain"
                onClick={() => setShowPassword((value) => !value)}
              />
            }
          />
          <TextField
            id="invite_password_confirm"
            label="Confirm password"
            type={showPassword ? 'text' : 'password'}
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
            autoComplete="new-password"
          />
          <Button type="submit" variant="primary" size="lg" block loading={loading}>
            Continue to multi-factor setup
          </Button>
        </form>
      )}
    </AuthFrame>
  )
}
