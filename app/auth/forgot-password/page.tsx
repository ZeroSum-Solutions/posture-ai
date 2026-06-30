'use client'
import { useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import Link from 'next/link'

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
    <div style={{ minHeight: '80vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
      <div style={{ width: '100%', maxWidth: '400px', background: '#161618', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '16px', padding: '32px' }}>
        <h1 style={{ fontSize: '1.4rem', fontWeight: 700, color: '#F5F5F5', marginBottom: '8px' }}>
          Reset password
        </h1>
        {sent ? (
          <>
            <p style={{ fontSize: '0.875rem', color: '#A1A1AA', marginBottom: '24px' }}>
              If an account exists for <strong style={{ color: '#F5F5F5' }}>{email}</strong>, we&apos;ve sent a
              link to reset your password. Check your inbox.
            </p>
            <Link href="/auth/sign-in" style={{ color: '#818CF8', textDecoration: 'none', fontSize: '0.85rem' }}>
              ← Back to sign in
            </Link>
          </>
        ) : (
          <>
            <p style={{ fontSize: '0.875rem', color: '#A1A1AA', marginBottom: '24px' }}>
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
                  color: '#EF4444',
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
                  style={{ display: 'block', fontSize: '0.85rem', color: '#A1A1AA', marginBottom: '6px' }}
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
                  background: loading ? 'rgba(99,102,241,0.5)' : '#4F46E5',
                  color: '#fff',
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
              <p style={{ textAlign: 'center', fontSize: '0.85rem', color: '#A1A1AA' }}>
                <Link href="/auth/sign-in" style={{ color: '#818CF8', textDecoration: 'none' }}>
                  Back to sign in
                </Link>
              </p>
            </form>
          </>
        )}
      </div>
    </div>
  )
}
