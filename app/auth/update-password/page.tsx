'use client'
import { useEffect, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import Link from 'next/link'
import { validatePasswordReset, MIN_PASSWORD_LENGTH } from '@/lib/auth/password'
import AuthFrame from '@/components/AuthFrame'

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
          <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>Verifying reset link…</p>
        ) : hasSession === false ? (
          <>
            <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: '24px' }}>
              This reset link is invalid or has expired. Request a new one to continue.
            </p>
            <Link href="/auth/forgot-password" style={{ color: 'var(--text-secondary)', textDecoration: 'none', fontSize: '0.85rem' }}>
              ← Request a new link
            </Link>
          </>
        ) : (
          <>
            <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: '24px' }}>
              Enter a new password for your account.
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
                  color: 'var(--review)',
                  fontSize: '0.85rem',
                  marginBottom: '16px',
                }}
              >
                {error}
              </div>
            )}
            <form onSubmit={handleSubmit} noValidate>
              <div style={{ marginBottom: '16px' }}>
                <label
                  htmlFor="new_password"
                  style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '6px' }}
                >
                  New password
                </label>
                <input
                  id="new_password"
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                  placeholder={`New password (min ${MIN_PASSWORD_LENGTH} characters)`}
                  aria-label="New password"
                  autoComplete="new-password"
                  style={inputStyle}
                />
              </div>
              <div style={{ marginBottom: '24px' }}>
                <label
                  htmlFor="confirm_password"
                  style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '6px' }}
                >
                  Confirm password
                </label>
                <input
                  id="confirm_password"
                  type="password"
                  value={confirm}
                  onChange={e => setConfirm(e.target.value)}
                  required
                  placeholder="Re-enter new password"
                  aria-label="Confirm password"
                  autoComplete="new-password"
                  style={inputStyle}
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                style={{
                  width: '100%',
                  padding: '11px',
                  background: loading ? 'rgba(255,255,255,0.45)' : 'var(--action)',
                  color: 'var(--action-text)',
                  border: 'none',
                  borderRadius: '8px',
                  fontWeight: 600,
                  fontSize: '0.95rem',
                  cursor: loading ? 'not-allowed' : 'pointer',
                }}
              >
                {loading ? 'Updating...' : 'Update password'}
              </button>
            </form>
          </>
        )}
    </AuthFrame>
  )
}
