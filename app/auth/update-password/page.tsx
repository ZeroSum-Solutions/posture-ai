'use client'
import { useEffect, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import Link from 'next/link'
import { validatePasswordReset, MIN_PASSWORD_LENGTH } from '@/lib/auth/password'
import AuthFrame from '@/components/AuthFrame'

export default function UpdatePasswordPage() {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
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
          <p className="a-help">Verifying reset link…</p>
        ) : hasSession === false ? (
          <>
            <p className="a-help" style={{ marginBottom: '24px' }}>
              This reset link is invalid or has expired. Request a new one to continue.
            </p>
            <Link href="/auth/forgot-password" className="a-label" style={{ textDecoration: 'underline' }}>
              ← Request a new link
            </Link>
          </>
        ) : (
          <>
            <p className="a-help" style={{ marginBottom: '24px' }}>
              Enter a new password for your account.
            </p>
            {error && (
              <p className="a-error" role="alert" aria-live="assertive" style={{ marginBottom: 16 }}>
                {error}
              </p>
            )}
            <form onSubmit={handleSubmit} noValidate className="a-form">
              <div className="a-field">
                <label className="a-label" htmlFor="new_password">New password</label>
                <input
                  id="new_password"
                  className="a-input"
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                  placeholder={`New password (min ${MIN_PASSWORD_LENGTH} characters)`}
                  aria-label="New password"
                  autoComplete="new-password"
                />
              </div>
              <div className="a-field">
                <label className="a-label" htmlFor="confirm_password">Confirm password</label>
                <input
                  id="confirm_password"
                  className="a-input"
                  type="password"
                  value={confirm}
                  onChange={e => setConfirm(e.target.value)}
                  required
                  placeholder="Re-enter new password"
                  aria-label="Confirm password"
                  autoComplete="new-password"
                />
              </div>
              <button type="submit" disabled={loading} className="a-primary a-primary--bar" style={{ marginTop: 6 }}>
                {loading ? 'Updating...' : 'Update password'}
              </button>
            </form>
          </>
        )}
    </AuthFrame>
  )
}
