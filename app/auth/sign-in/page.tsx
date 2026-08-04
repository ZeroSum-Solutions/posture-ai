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

  return (
    <AuthFrame title="Welcome back" description="Sign in with the email address tied to your practitioner invitation.">
        {error && (
          <p className="a-error" role="alert" aria-live="assertive" style={{ marginBottom: 16 }}>
            {error}
          </p>
        )}

        <form onSubmit={handleSubmit} noValidate className="a-form">
          <div className="a-field">
            <label className="a-label" htmlFor="email">Email</label>
            <input
              id="email"
              className="a-input"
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              placeholder="you@example.com"
              autoComplete="email"
              inputMode="email"
            />
          </div>

          <div className="a-field">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <label className="a-label" htmlFor="password">Password</label>
              <Link href="/auth/forgot-password" className="a-label" style={{ textDecoration: 'underline' }}>
                Forgot password?
              </Link>
            </div>
            <input
              id="password"
              className="a-input"
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              placeholder="Your password"
              autoComplete="current-password"
            />
          </div>

          <button type="submit" disabled={loading} className="a-primary a-primary--bar" style={{ marginTop: 6 }}>
            {loading ? 'Signing in...' : 'Sign in'}
          </button>

          <p className="a-help" style={{ textAlign: 'center' }}>
            Practitioner access is invitation-only.{' '}
            <Link href="/auth/sign-up" style={{ color: 'var(--text-secondary)', textDecoration: 'underline' }}>
              Learn how invitations work
            </Link>
          </p>
        </form>
    </AuthFrame>
  )
}
