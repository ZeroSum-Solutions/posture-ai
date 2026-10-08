'use client'
import { useEffect, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import Link from 'next/link'
import { validatePasswordReset, MIN_PASSWORD_LENGTH } from '@/lib/auth/password'
import { hardNavigate } from '@/lib/auth/safe-next'
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
  const [securityCheckError, setSecurityCheckError] = useState(false)
  const [mfaRetry, setMfaRetry] = useState(false)

  useEffect(() => {
    const supabase = createSupabaseBrowserClient()
    // getUser validates the recovery JWT with Auth. getSession only reads local
    // storage and must not decide whether this security-sensitive form is usable.
    async function checkRecoverySession() {
      const { data, error: userError } = await supabase.auth.getUser()
      if (userError || !data.user) {
        setHasSession(false)
        return
      }

      const { data: factors, error: factorsError } = await supabase.auth.mfa.listFactors()
      if (factorsError || !factors) {
        setSecurityCheckError(true)
        return
      }

      const hasVerifiedTotp = factors.all.some(
        (factor) => factor.factor_type === 'totp' && factor.status === 'verified',
      )
      if (hasVerifiedTotp) {
        const { data: assurance, error: assuranceError } =
          await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
        if (assuranceError || !assurance) {
          setSecurityCheckError(true)
          return
        }
        if (assurance.currentLevel !== 'aal2') {
          hardNavigate('/auth/mfa?mode=recovery&next=/auth/update-password')
          return
        }
      }

      setHasSession(true)
    }
    void checkRecoverySession()
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const validationError = validatePasswordReset(password, confirm)
    if (validationError) {
      setError(validationError)
      return
    }
    setError(null)
    setMfaRetry(false)
    setLoading(true)
    const supabase = createSupabaseBrowserClient()
    const { error } = await supabase.auth.updateUser({ password })
    setLoading(false)
    if (error) {
      if (/AAL2 session is required/i.test(error.message)) {
        setError('Verify your authenticator again before updating your password.')
        setMfaRetry(true)
      } else {
        setError('Could not update your password. Please try again.')
      }
      return
    }
    // A password reset never grants protected access. Existing users must
    // challenge their factor; approved lost-factor recovery must re-enroll one.
    hardNavigate('/auth/mfa?mode=recovery&next=/dashboard')
  }

  return (
    <AuthFrame title="Choose a new password" description="Create a fresh password for your practitioner account.">
      {securityCheckError ? (
        <p className="t-body" role="alert" style={{ color: 'var(--text-2)' }}>
          Could not verify your account security. Reload this page and try again.
        </p>
      ) : hasSession === null ? (
        <p className="t-body" style={{ color: 'var(--text-2)' }}>Verifying reset link…</p>
      ) : hasSession === false ? (
        <div className="app-stack">
          <p className="t-body" style={{ color: 'var(--text-2)' }}>
            This reset link is invalid or has expired. Request a new one to continue.
          </p>
          <Link
            href="/auth/forgot-password"
            className="t-callout"
            style={{ display: 'inline-flex', alignItems: 'center', minHeight: 48, textDecoration: 'none', color: 'var(--ink-1)' }}
          >
            ← Request a new link
          </Link>
        </div>
      ) : (
        <>
          {error && (
            <Banner variant="error" className="app-stack" data-testid="update-password-error">{error}</Banner>
          )}
          {mfaRetry && (
            <Link href="/auth/mfa?mode=recovery&next=/auth/update-password" className="t-callout">
              Verify authenticator again
            </Link>
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
