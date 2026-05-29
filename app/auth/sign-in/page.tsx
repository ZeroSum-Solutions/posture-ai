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
        <form onSubmit={handleSubmit}>
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
