'use client'
import { useState } from 'react'
import Link from 'next/link'

interface MuscleRow {
  slug: string
  name: string
  region: string
  function_text: string
  reviewed_at: string | null
}

const REGION_LABELS: Record<string, string> = {
  head_neck: 'Head & Neck',
  shoulder_girdle: 'Shoulder Girdle',
  trunk: 'Trunk',
  hip_pelvis: 'Hip & Pelvis',
  knee_leg: 'Knee & Lower Leg',
}
const REGION_ORDER = ['head_neck', 'shoulder_girdle', 'trunk', 'hip_pelvis', 'knee_leg']

export function MuscleLibrary({ muscles }: { muscles: MuscleRow[] }) {
  const [search, setSearch] = useState('')

  const q = search.trim().toLowerCase()
  const filtered = q
    ? muscles.filter(m => m.name.toLowerCase().includes(q) || m.region.replace('_', ' ').includes(q))
    : muscles

  const regions = REGION_ORDER.filter(r => filtered.some(m => m.region === r))

  return (
    <div>
      <input
        type="search"
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder="Search muscles…"
        aria-label="Search muscles"
        style={{
          width: '100%', padding: '10px 14px', borderRadius: '10px', marginBottom: '24px',
          background: '#161618', border: '1px solid rgba(255,255,255,0.12)', color: '#F5F5F5',
          fontSize: '0.9rem',         }}
      />

      {filtered.length === 0 && (
        <p style={{ color: '#A1A1AA' }}>No muscles match &ldquo;{search}&rdquo;.</p>
      )}

      {regions.map(region => (
        <section key={region} style={{ marginBottom: '28px' }}>
          <h2 style={{ fontSize: '1.05rem', fontWeight: 600, color: '#C7C9FF', marginBottom: '12px' }}>
            {REGION_LABELS[region] ?? region}
          </h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '14px' }}>
            {filtered.filter(m => m.region === region).map(m => (
              <Link
                key={m.slug}
                href={`/muscles/${m.slug}`}
                data-testid={`muscle-card-${m.slug}`}
                style={{
                  background: '#161618', border: '1px solid rgba(255,255,255,0.08)',
                  borderRadius: '10px', padding: '16px', textDecoration: 'none', display: 'block',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }}>
                  <span style={{ fontWeight: 600, color: '#F5F5F5', fontSize: '0.95rem' }}>{m.name}</span>
                  {!m.reviewed_at && (
                    <span style={{
                      fontSize: '0.65rem', padding: '2px 8px', borderRadius: '4px', flexShrink: 0,
                      background: 'rgba(245,158,11,0.15)', color: '#FCD34D', textTransform: 'uppercase',
                    }}>
                      Pending review
                    </span>
                  )}
                </div>
                <p style={{ fontSize: '0.82rem', color: '#A1A1AA', lineHeight: 1.5, margin: '8px 0 0' }}>
                  {m.function_text.length > 110 ? m.function_text.slice(0, 107) + '…' : m.function_text}
                </p>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
