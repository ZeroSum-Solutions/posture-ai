'use client'
import { useEffect, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import Link from 'next/link'
import AuthFrame from '@/components/AuthFrame'

export default function SignInPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const reason = new URLSearchParams(window.location.search).get('reason')
    const messages: Record<string, string> = {
      invite_invalid: 'This invitation link is invalid, expired, or has already been used.',
      recovery_invalid: 'This password-recovery link is invalid, expired, or has already been used.',
      access_revoked: 'Practitioner access has been revoked. Contact your beta administrator.',
      access_unavailable: 'Practitioner access could not be verified. Please try again.',
      access_review_required: 'This existing practitioner account requires administrator approval before it can be used.',
      access_denied: 'This account does not have practitioner access.',
      session_stale: 'This session was ended during account recovery. Sign in again to continue.',
      signed_out: 'You have been signed out on this device.',
    }
    const message = reason ? messages[reason] : null
    if (!message) return
    const timer = window.setTimeout(() => setError(message), 0)
    return () => window.clearTimeout(timer)
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    const supabase = createSupabaseBrowserClient()
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    setLoading(false)
    if (error) {
      setError(error.message)
    } else {
      // A password login is AAL1 even when a verified factor exists. Hard
      // navigate to the only pre-AAL2 corridor; proxy blocks the dashboard.
      window.location.assign('/auth/mfa?next=/dashboard')
    }
  }

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

  return (
    <AuthFrame title="Welcome back" description="Sign in with the email address tied to your practitioner invitation.">
        {error && (
          <div
            role="alert"
            aria-live="assertive"
            style={{
              background: 'rgba(239,68,68,0.12)',
              border: '1px solid rgba(239,68,68,0.3)',
              borderRadius: '8px',
              padding: '12px',
              color: 'var(--danger)',
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
          <div style={{ marginBottom: '24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '6px' }}>
              <label
                htmlFor="password"
                style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}
              >
                Password
              </label>
              <Link href="/auth/forgot-password" style={{ fontSize: '0.8rem', color: 'var(--brand)', textDecoration: 'underline' }}>
                Forgot password?
              </Link>
            </div>
            <input
              id="password"
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              placeholder="Your password"
              aria-label="Password"
              autoComplete="current-password"
              style={inputStyle}
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            style={{
              width: '100%',
              padding: '11px',
              background: loading ? 'rgba(0,152,243,0.5)' : 'var(--brand-strong)',
              color: '#fff',
              border: 'none',
              borderRadius: '8px',
              fontWeight: 600,
              fontSize: '0.95rem',
              cursor: loading ? 'not-allowed' : 'pointer',
              marginBottom: '16px',
            }}
          >
            {loading ? 'Signing in...' : 'Sign in'}
          </button>
          <p style={{ textAlign: 'center', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
            Practitioner access is invitation-only.{' '}
            <Link href="/auth/sign-up" style={{ color: 'var(--brand)', textDecoration: 'underline' }}>
              Learn how invitations work
            </Link>
          </p>
        </form>
    </AuthFrame>
  )
}
