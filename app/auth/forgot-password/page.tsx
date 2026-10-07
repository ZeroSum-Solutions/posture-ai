'use client'
import { useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import Link from 'next/link'
import AuthFrame from '@/components/AuthFrame'
import { Banner } from '@/components/ui/Banner'
import { Button } from '@/components/ui/Button'
import { TextField } from '@/components/ui/TextField'

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
        <div className="app-stack">
          <p className="t-body" style={{ color: 'var(--text-2)' }}>
            If an account exists for <strong style={{ color: 'var(--text-1)' }}>{email}</strong>, we&apos;ve sent a
            link to reset your password. Check your inbox.
          </p>
          <Link
            href="/auth/sign-in"
            className="t-footnote"
            style={{ display: 'inline-flex', alignItems: 'center', minHeight: 48, textDecoration: 'underline', color: 'var(--text-2)' }}
          >
            ← Back to sign in
          </Link>
        </div>
      ) : (
        <>
          <p className="t-body" style={{ color: 'var(--text-2)', marginBottom: 'var(--s-24)' }}>
            Enter your email and we&apos;ll send you a link to reset your password.
          </p>
          {error && (
            <Banner variant="error" className="app-stack" data-testid="forgot-password-error">{error}</Banner>
          )}
          <form onSubmit={handleSubmit} noValidate className="app-stack" style={{ marginTop: error ? 'var(--s-16)' : 0 }}>
            <TextField
              id="email"
              label="Email"
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              placeholder="you@example.com"
              autoComplete="email"
              inputMode="email"
            />
            <Button type="submit" variant="primary" size="lg" block loading={loading}>
              Send reset link
            </Button>
            <p className="t-footnote" style={{ textAlign: 'center', color: 'var(--text-3)' }}>
              <Link
                href="/auth/sign-in"
                style={{ display: 'inline-flex', alignItems: 'center', minHeight: 48, color: 'var(--text-2)', textDecoration: 'underline' }}
              >
                Back to sign in
              </Link>
            </p>
          </form>
        </>
      )}
    </AuthFrame>
  )
}
