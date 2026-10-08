'use client'
import { useEffect, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import Link from 'next/link'
import { validatePasswordReset, MIN_PASSWORD_LENGTH } from '@/lib/auth/password'
import AuthFrame from '@/components/AuthFrame'
import { Banner } from '@/components/ui/Banner'
import { Button } from '@/components/ui/Button'
import { IconButton } from '@/components/ui/IconButton'
import { TextField } from '@/components/ui/TextField'

export default function UpdatePasswordPage() {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  // null = still checking for a recovery session, true/false = result
  const [hasSession, setHasSession] = useState<boolean | null>(null)

  useEffect(() => {
    const supabase = createSupabaseBrowserClient()
    // getUser validates the recovery JWT with Auth. getSession only reads local
    // storage and must not decide whether this security-sensitive form is usable.
    supabase.auth.getUser().then(({ data, error: userError }) => {
      setHasSession(!userError && !!data.user)
    })
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const validationError = validatePasswordReset(password, confirm)
    if (validationError) {
      setError(validationError)
      return
    }
    setError(null)
    setLoading(true)
    const supabase = createSupabaseBrowserClient()
    const { error } = await supabase.auth.updateUser({ password })
    setLoading(false)
    if (error) {
      setError(error.message)
      return
    }
    // A password reset never grants protected access. Existing users must
    // challenge their factor; approved lost-factor recovery must re-enroll one.
    window.location.assign('/auth/mfa?mode=recovery&next=/dashboard')
  }

  return (
    <AuthFrame title="Choose a new password" description="Create a fresh password for your practitioner account.">
      {hasSession === null ? (
        <p className="t-body" style={{ color: 'var(--text-2)' }}>Verifying reset link…</p>
      ) : hasSession === false ? (
        <div className="app-stack">
          <p className="t-body" style={{ color: 'var(--text-2)' }}>
            This reset link is invalid or has expired. Request a new one to continue.
          </p>
          <Link
            href="/auth/forgot-password"
            className="t-footnote"
            style={{ display: 'inline-flex', alignItems: 'center', minHeight: 48, textDecoration: 'underline', color: 'var(--text-2)' }}
          >
            ← Request a new link
          </Link>
        </div>
      ) : (
        <>
          <p className="t-body" style={{ color: 'var(--text-2)', marginBottom: 'var(--s-24)' }}>
            Enter a new password for your account.
          </p>
          {error && (
            <Banner variant="error" className="app-stack" data-testid="update-password-error">{error}</Banner>
          )}
          <form onSubmit={handleSubmit} noValidate className="app-stack" style={{ marginTop: error ? 'var(--s-16)' : 0 }}>
            <TextField
              id="new_password"
              label="New password"
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              placeholder={`New password (min ${MIN_PASSWORD_LENGTH} characters)`}
              autoComplete="new-password"
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
              id="confirm_password"
              label="Confirm password"
              type={showPassword ? 'text' : 'password'}
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
              required
              placeholder="Re-enter new password"
              autoComplete="new-password"
            />
            <Button type="submit" variant="primary" size="lg" block loading={loading}>
              Update password
            </Button>
          </form>
        </>
      )}
    </AuthFrame>
  )
}
