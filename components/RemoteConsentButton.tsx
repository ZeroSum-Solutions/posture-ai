'use client'
import { useState } from 'react'
import { Surface } from '@/components/array/Surface'
import { Banner } from '@/components/ui/Banner'
import { Button } from '@/components/ui/Button'
import { TextField } from '@/components/ui/TextField'
import styles from './RemoteConsentButton.module.css'

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

  if (state === 'ready' && link) {
    return (
      <Surface tier="tile" innerClassName={styles.panel}>
        <p className="t-callout" style={{ color: 'var(--text-2)' }}>
          Consent pending — share this link or QR with the subject. It is single-use and expires in 7 days.
        </p>
        <div className={styles.linkRow}>
          <TextField
            label="Consent link"
            readOnly
            value={link.url}
            onFocus={e => e.currentTarget.select()}
          />
          <Button variant="secondary" style={{ alignSelf: 'flex-start' }} onClick={() => copyLink(link.url)}>
            {copied ? 'Copied' : 'Copy link'}
          </Button>
        </div>
        {error && <Banner variant="error">{error}</Banner>}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={link.qr} alt="Remote consent QR code" width={160} height={160} className={styles.qr} />
      </Surface>
    )
  }

  return (
    <Surface tier="tile" innerClassName={styles.panel}>
      <p className="t-callout" style={{ color: 'var(--text-2)' }}>
        Subject consent is pending. Capture is blocked until the subject (or their guardian) consents.
      </p>
      <div className={styles.actionRow}>
        <Button variant="secondary" loading={state === 'loading'} onClick={generate}>
          Send remote consent link
        </Button>
        {error && <Banner variant="error">{error}</Banner>}
      </div>
    </Surface>
  )
}
