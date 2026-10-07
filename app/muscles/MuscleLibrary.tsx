'use client'
import { useState } from 'react'
import { AnatomyGlyph } from '@/components/SignalGlyphs'
import { Chip } from '@/components/array/Chip'
import { Surface, SurfaceLink } from '@/components/array/Surface'

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
    <>
      <input
        type="search"
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder="Search muscles…"
        aria-label="Search muscles"
      />

      {filtered.length === 0 && (
        <Surface tier="tile" pad="rowy">
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            <span style={{ flexShrink: 0, color: 'var(--text-tertiary)' }}><AnatomyGlyph /></span>
            <div>
              <h2 className="t-headline">
                {muscles.length === 0 ? 'The reviewed guide is being prepared' : 'No matching muscles'}
              </h2>
              <p className="t-body" style={{ marginTop: 4 }}>
                {muscles.length === 0
                  ? 'Reviewed anatomy entries will appear here as they clear the content gate.'
                  : <>Try a different muscle or region than &ldquo;{search}&rdquo;.</>}
              </p>
            </div>
          </div>
        </Surface>
      )}

      {regions.map(region => (
        <section key={region} className="app-stack">
          <h2 className="t-title-2">{REGION_LABELS[region] ?? region}</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 10 }}>
            {filtered.filter(m => m.region === region).map(m => (
              <SurfaceLink key={m.slug} href={`/muscles/${m.slug}`} tier="row">
                <span data-testid={`muscle-card-${m.slug}`} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                    <span className="t-headline">{m.name}</span>
                    {!m.reviewed_at && <Chip band="monitor" size="sm">Pending review</Chip>}
                  </span>
                  <span className="t-body">
                    {m.function_text.length > 110 ? m.function_text.slice(0, 107) + '…' : m.function_text}
                  </span>
                </span>
              </SurfaceLink>
            ))}
          </div>
        </section>
      ))}
    </>
  )
}
