'use client'
import { useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import Link from 'next/link'
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

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    // The form sets noValidate, so validate the address ourselves before sending.
    const normalized = email.trim()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
      setError('Enter a valid email address.')
      return
    }
    setLoading(true)
    const supabase = createSupabaseBrowserClient()
    await supabase.auth.resetPasswordForEmail(normalized, {
      redirectTo: window.location.origin + '/auth/callback?next=/auth/update-password',
    })
    setLoading(false)
    // Always show the same neutral confirmation — including on errors and
    // throttling — so the form can't reveal which emails are registered.
    // Operational failures are surfaced via server-side auth logs, not here.
    setSent(true)
  }

  return (
    <AuthFrame title="Reset password" description="Request a secure link to regain access to your workspace.">
        {sent ? (
          <>
            <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: '24px' }}>
              If an account exists for <strong style={{ color: 'var(--text-primary)' }}>{email}</strong>, we&apos;ve sent a
              link to reset your password. Check your inbox.
            </p>
            <Link href="/auth/sign-in" style={{ color: 'var(--text-secondary)', textDecoration: 'none', fontSize: '0.85rem' }}>
              ← Back to sign in
            </Link>
          </>
        ) : (
          <>
            <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: '24px' }}>
              Enter your email and we&apos;ll send you a link to reset your password.
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
              <div style={{ marginBottom: '24px' }}>
                <label
                  htmlFor="email"
                  style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '6px' }}
                >
                  Email
                </label>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  required
                  placeholder="you@example.com"
                  aria-label="Email"
                  autoComplete="email"
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
                  marginBottom: '16px',
                }}
              >
                {loading ? 'Sending...' : 'Send reset link'}
              </button>
              <p style={{ textAlign: 'center', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                <Link href="/auth/sign-in" style={{ color: 'var(--text-secondary)', textDecoration: 'none' }}>
                  Back to sign in
                </Link>
              </p>
            </form>
          </>
        )}
    </AuthFrame>
  )
}
