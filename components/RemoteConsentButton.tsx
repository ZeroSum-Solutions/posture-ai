'use client'
import { useState } from 'react'

/** Practitioner-side entry point for remote subject consent: mints a link + QR
 *  (POST /api/consent/link) that the subject completes at /consent/[token]. */
export default function RemoteConsentButton({ clientId }: { clientId: string }) {
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [link, setLink] = useState<{ url: string; qr: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  async function generate() {
    setState('loading'); setError(null)
    try {
      const res = await fetch('/api/consent/link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: clientId }),
      })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error || 'Failed to create consent link.')
      setLink({ url: j.url, qr: j.qr }); setState('ready')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create consent link.')
      setState('error')
    }
  }

  async function copyLink(url: string) {
    try {
      if (!navigator.clipboard) throw new Error('clipboard unavailable')
      await navigator.clipboard.writeText(url)
      setError(null)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      setError('Could not copy the link automatically. Select it and copy it manually.')
    }
  }

  const panel: React.CSSProperties = {
    background: 'rgba(255,137,24,0.08)', border: '1px solid rgba(255,137,24,0.3)',
    borderRadius: 10, padding: 16,
  }

  if (state === 'ready' && link) {
    return (
      <div style={panel}>
        <p style={{ margin: '0 0 10px', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
          Consent pending — share this link or QR with the subject. It is single-use and expires in 7 days.
        </p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
          <input
            readOnly value={link.url} onFocus={e => e.currentTarget.select()}
            style={{ flex: 1, minWidth: 200, padding: '8px 10px', background: 'var(--background)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8, color: 'var(--text-primary)', fontSize: '0.8rem' }}
          />
          <button
            onClick={() => copyLink(link.url)}
            style={{ padding: '8px 14px', borderRadius: 8, background: 'var(--brand)', color: '#fff', border: 'none', fontWeight: 600, fontSize: '0.8rem', cursor: 'pointer' }}
          >
            {copied ? 'Copied' : 'Copy link'}
          </button>
        </div>
        {error && <p role="alert" style={{ margin: '0 0 12px', color: 'var(--danger)', fontSize: '0.8rem' }}>{error}</p>}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={link.qr} alt="Remote consent QR code" width={160} height={160} style={{ borderRadius: 8, background: '#fff', padding: 4 }} />
      </div>
    )
  }

  return (
    <div style={panel}>
      <p style={{ margin: '0 0 10px', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
        Subject consent is pending. Capture is blocked until the subject (or their guardian) consents.
      </p>
      <button
        onClick={generate} disabled={state === 'loading'}
        style={{ padding: '9px 16px', borderRadius: 8, background: 'var(--warning)', color: '#1A1205', border: 'none', fontWeight: 700, fontSize: '0.85rem', cursor: state === 'loading' ? 'not-allowed' : 'pointer' }}
      >
        {state === 'loading' ? 'Generating…' : 'Send remote consent link'}
      </button>
      {error && <span role="alert" style={{ marginLeft: 10, color: 'var(--danger)', fontSize: '0.8rem' }}>{error}</span>}
    </div>
  )
}
