'use client'
import { useState } from 'react'
import { CONSENT_TEXT } from '@/lib/consent/text'

export default function ConsentResponder({ token }: { token: string }) {
  const [name, setName] = useState('')
  const [rel, setRel] = useState('self')
  const [status, setStatus] = useState<'idle' | 'submitting' | 'done' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) { setError('Please type the signer’s full name to sign.'); return }
    setStatus('submitting'); setError(null)
    try {
      const res = await fetch('/api/consent/respond', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, signer_name: name, signer_relationship: rel }),
      })
      if (res.ok) { setStatus('done'); return }
      const j = await res.json().catch(() => ({}))
      setError(j.error || 'Something went wrong.')
      setStatus('error')
    } catch {
      setError('Network error — please try again.')
      setStatus('error')
    }
  }

  const wrap: React.CSSProperties = {
    maxWidth: 560, margin: '0 auto', padding: '32px 20px', color: '#F5F5F5',
  }
  const input: React.CSSProperties = {
    width: '100%', padding: '10px 12px', background: '#0A0A0B',
    border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8, color: '#F5F5F5',
    fontSize: '0.95rem', boxSizing: 'border-box', minHeight: 44,
  }

  if (status === 'done') {
    return (
      <main style={wrap}>
        <h1 style={{ fontSize: '1.4rem', marginBottom: 12 }}>Consent recorded</h1>
        <p style={{ color: '#A1A1AA', lineHeight: 1.6 }}>
          Thank you. Your consent has been recorded. You can close this page.
        </p>
      </main>
    )
  }

  return (
    <main style={wrap}>
      <h1 style={{ fontSize: '1.4rem', marginBottom: 16 }}>Posture Screening Consent</h1>
      <pre style={{
        whiteSpace: 'pre-wrap', fontFamily: 'inherit', fontSize: '0.9rem', lineHeight: 1.6,
        color: '#D4D4D8', background: '#161618', border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 12, padding: 16, marginBottom: 20,
      }}>{CONSENT_TEXT}</pre>

      <form onSubmit={submit} aria-label="Remote consent form">
        {error && (
          <div role="alert" style={{
            background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.3)',
            borderRadius: 8, padding: 12, color: '#EF4444', fontSize: '0.875rem', marginBottom: 16,
          }}>{error}</div>
        )}

        <label htmlFor="signer_relationship" style={{ display: 'block', fontSize: '0.85rem', color: '#A1A1AA', marginBottom: 6 }}>
          I am signing as
        </label>
        <select id="signer_relationship" value={rel} onChange={e => setRel(e.target.value)} style={{ ...input, marginBottom: 16 }}>
          <option value="self">The person being screened (myself)</option>
          <option value="parent">Parent of the person being screened</option>
          <option value="legal_guardian">Legal guardian of the person being screened</option>
          <option value="other">Other authorized representative</option>
        </select>

        <label htmlFor="signer_name" style={{ display: 'block', fontSize: '0.85rem', color: '#A1A1AA', marginBottom: 6 }}>
          Type full name to sign <span style={{ color: '#EF4444' }}>*</span>
        </label>
        <input
          id="signer_name" type="text" value={name} onChange={e => setName(e.target.value)}
          placeholder="Full legal name" style={{ ...input, marginBottom: 20 }}
          required aria-required="true"
        />

        <button type="submit" disabled={status === 'submitting'} style={{
          width: '100%', padding: 12, background: status === 'submitting' ? 'rgba(99,102,241,0.4)' : '#4F46E5',
          color: '#fff', border: 'none', borderRadius: 8, fontWeight: 600, fontSize: '0.95rem',
          cursor: status === 'submitting' ? 'not-allowed' : 'pointer',
        }}>
          {status === 'submitting' ? 'Submitting…' : 'I Agree & Sign'}
        </button>
      </form>
    </main>
  )
}
