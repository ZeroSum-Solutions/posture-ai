'use client'
import { useEffect, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { validatePasswordReset } from '@/lib/auth/password'

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  background: '#0A0A0B',
  border: '1px solid rgba(255,255,255,0.12)',
  borderRadius: '8px',
  color: '#F5F5F5',
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
  const router = useRouter()

  useEffect(() => {
    const supabase = createSupabaseBrowserClient()
    supabase.auth.getSession().then(({ data }) => {
      setHasSession(!!data.session)
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
    router.push('/dashboard')
    router.refresh()
  }

  return (
    <div style={{ minHeight: '80vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
      <div style={{ width: '100%', maxWidth: '400px', background: '#161618', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '16px', padding: '32px' }}>
        <h1 style={{ fontSize: '1.4rem', fontWeight: 700, color: '#F5F5F5', marginBottom: '8px' }}>
          Choose a new password
        </h1>

        {hasSession === null ? (
          <p style={{ fontSize: '0.875rem', color: '#A1A1AA' }}>Verifying reset link…</p>
        ) : hasSession === false ? (
          <>
            <p style={{ fontSize: '0.875rem', color: '#A1A1AA', marginBottom: '24px' }}>
              This reset link is invalid or has expired. Request a new one to continue.
            </p>
            <Link href="/auth/forgot-password" style={{ color: '#818CF8', textDecoration: 'none', fontSize: '0.85rem' }}>
              ← Request a new link
            </Link>
          </>
        ) : (
          <>
            <p style={{ fontSize: '0.875rem', color: '#A1A1AA', marginBottom: '24px' }}>
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
                  color: '#EF4444',
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
                  style={{ display: 'block', fontSize: '0.85rem', color: '#A1A1AA', marginBottom: '6px' }}
                >
                  New password
                </label>
                <input
                  id="new_password"
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                  placeholder="New password (min 6 characters)"
                  aria-label="New password"
                  autoComplete="new-password"
                  style={inputStyle}
                />
              </div>
              <div style={{ marginBottom: '24px' }}>
                <label
                  htmlFor="confirm_password"
                  style={{ display: 'block', fontSize: '0.85rem', color: '#A1A1AA', marginBottom: '6px' }}
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
                  background: loading ? 'rgba(99,102,241,0.5)' : '#6366F1',
                  color: '#fff',
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
      </div>
    </div>
  )
}
