'use client'
import { useEffect, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import Link from 'next/link'
import AuthFrame from '@/components/AuthFrame'
import { Banner } from '@/components/ui/Banner'
import { Button } from '@/components/ui/Button'
import { IconButton } from '@/components/ui/IconButton'
import { TextField } from '@/components/ui/TextField'

export default function SignInPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
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
        <Banner variant="error" className="app-stack" data-testid="sign-in-error">{error}</Banner>
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

        <TextField
          id="password"
          label="Password"
          type={showPassword ? 'text' : 'password'}
          value={password}
          onChange={e => setPassword(e.target.value)}
          required
          placeholder="Your password"
          autoComplete="current-password"
          trailing={
            <IconButton
              icon={showPassword ? 'eye-closed-linear' : 'eye-linear'}
              label={showPassword ? 'Hide password' : 'Show password'}
              variant="plain"
              onClick={() => setShowPassword((value) => !value)}
            />
          }
        />
        <Link
          href="/auth/forgot-password"
          className="t-label"
          style={{ display: 'inline-flex', alignItems: 'center', alignSelf: 'flex-end', minHeight: 44, marginTop: 'calc(var(--s-8) * -1)', color: 'var(--ink-1)', textDecoration: 'none' }}
        >
          Forgot password?
        </Link>

        <Button type="submit" variant="primary" size="lg" block loading={loading}>
          Sign in
        </Button>

        <p className="t-footnote" style={{ textAlign: 'center', color: 'var(--text-3)' }}>
          Practitioner access is invitation-only.{' '}
          <Link href="/auth/sign-up" style={{ color: 'var(--text-2)', textDecoration: 'underline' }}>
            Learn how invitations work
          </Link>
        </p>
      </form>
    </AuthFrame>
  )
}
