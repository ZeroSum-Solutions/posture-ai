'use client'
import { useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

export default function SignInPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)
  const router = useRouter()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    const supabase = createSupabaseBrowserClient()
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    setLoading(false)
    if (error) {
      setError(error.message)
    } else {
      router.push('/dashboard')
      router.refresh()
    }
  }

  async function handleGoogleSignIn() {
    setError(null)
    setGoogleLoading(true)
    const supabase = createSupabaseBrowserClient()
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin + '/auth/callback',
      },
    })
    setGoogleLoading(false)
    if (error) {
      setError(error.message)
    }
  }

  return (
    <div style={{
      minHeight: '80vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '24px',
    }}>
      <div style={{
        width: '100%',
        maxWidth: '400px',
        background: '#161618',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: '16px',
        padding: '32px',
      }}>
        <h1 style={{ fontSize: '1.4rem', fontWeight: 700, color: '#F5F5F5', marginBottom: '8px' }}>
          Sign in
        </h1>
        <p style={{ fontSize: '0.875rem', color: '#A1A1AA', marginBottom: '24px' }}>
          Sign in to your Posture AI account
        </p>
        {error && (
          <div style={{
            background: 'rgba(239,68,68,0.12)',
            border: '1px solid rgba(239,68,68,0.3)',
            borderRadius: '8px',
            padding: '12px',
            color: '#EF4444',
            fontSize: '0.85rem',
            marginBottom: '16px',
          }}>
            {error}
          </div>
        )}

        {/* Google OAuth Button */}
        <button
          type="button"
          onClick={handleGoogleSignIn}
          disabled={googleLoading || loading}
          style={{
            width: '100%',
            padding: '11px',
            background: 'transparent',
            color: '#F5F5F5',
            border: '1px solid rgba(255,255,255,0.2)',
            borderRadius: '8px',
            fontWeight: 600,
            fontSize: '0.95rem',
            cursor: (googleLoading || loading) ? 'not-allowed' : 'pointer',
            marginBottom: '16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '10px',
            opacity: (googleLoading || loading) ? 0.6 : 1,
          }}
        >
          {!googleLoading && (
            <svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
              <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 01-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4"/>
              <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 009 18z" fill="#34A853"/>
              <path d="M3.964 10.71A5.41 5.41 0 013.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 000 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/>
              <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 00.957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
            </svg>
          )}
          {googleLoading ? 'Redirecting...' : 'Continue with Google'}
        </button>

        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          marginBottom: '16px',
        }}>
          <div style={{ flex: 1, height: '1px', background: 'rgba(255,255,255,0.1)' }} />
          <span style={{ fontSize: '0.8rem', color: '#71717A' }}>or</span>
          <div style={{ flex: 1, height: '1px', background: 'rgba(255,255,255,0.1)' }} />
        </div>

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', fontSize: '0.85rem', color: '#A1A1AA', marginBottom: '6px' }}>
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              placeholder="you@example.com"
              style={{
                width: '100%',
                padding: '10px 12px',
                background: '#0A0A0B',
                border: '1px solid rgba(255,255,255,0.12)',
                borderRadius: '8px',
                color: '#F5F5F5',
                fontSize: '0.9rem',
                outline: 'none',
                boxSizing: 'border-box',
              }}
            />
          </div>
          <div style={{ marginBottom: '24px' }}>
            <label style={{ display: 'block', fontSize: '0.85rem', color: '#A1A1AA', marginBottom: '6px' }}>
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              placeholder="Your password"
              style={{
                width: '100%',
                padding: '10px 12px',
                background: '#0A0A0B',
                border: '1px solid rgba(255,255,255,0.12)',
                borderRadius: '8px',
                color: '#F5F5F5',
                fontSize: '0.9rem',
                outline: 'none',
                boxSizing: 'border-box',
              }}
            />
          </div>
          <button
            type="submit"
            disabled={loading || googleLoading}
            style={{
              width: '100%',
              padding: '11px',
              background: (loading || googleLoading) ? 'rgba(99,102,241,0.5)' : '#6366F1',
              color: '#fff',
              border: 'none',
              borderRadius: '8px',
              fontWeight: 600,
              fontSize: '0.95rem',
              cursor: (loading || googleLoading) ? 'not-allowed' : 'pointer',
              marginBottom: '16px',
            }}
          >
            {loading ? 'Signing in...' : 'Sign in'}
          </button>
          <p style={{ textAlign: 'center', fontSize: '0.85rem', color: '#A1A1AA' }}>
            No account yet?{' '}
            <Link href="/auth/sign-up" style={{ color: '#6366F1', textDecoration: 'none' }}>
              Create one
            </Link>
          </p>
        </form>
      </div>
    </div>
  )
}
