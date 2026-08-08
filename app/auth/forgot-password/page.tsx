'use client'
import { useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import Link from 'next/link'
import AuthFrame from '@/components/AuthFrame'

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
            <p className="a-help" style={{ marginBottom: '24px' }}>
              If an account exists for <strong style={{ color: 'var(--text-primary)' }}>{email}</strong>, we&apos;ve sent a
              link to reset your password. Check your inbox.
            </p>
            <Link href="/auth/sign-in" className="a-label" style={{ textDecoration: 'underline' }}>
              ← Back to sign in
            </Link>
          </>
        ) : (
          <>
            <p className="a-help" style={{ marginBottom: '24px' }}>
              Enter your email and we&apos;ll send you a link to reset your password.
            </p>
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
                  aria-label="Email"
                  autoComplete="email"
                  inputMode="email"
                />
              </div>
              <button type="submit" disabled={loading} className="a-primary a-primary--bar" style={{ marginTop: 6 }}>
                {loading ? 'Sending...' : 'Send reset link'}
              </button>
              <p className="a-help" style={{ textAlign: 'center' }}>
                <Link href="/auth/sign-in" style={{ color: 'var(--text-secondary)', textDecoration: 'underline' }}>
                  Back to sign in
                </Link>
              </p>
            </form>
          </>
        )}
    </AuthFrame>
  )
}
