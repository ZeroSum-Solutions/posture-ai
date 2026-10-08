'use client'
import { useState } from 'react'
import { AnatomyGlyph } from '@/components/SignalGlyphs'
import { EmptyState, SearchField, SeverityChip } from '@/components/ui'
import { SurfaceLink } from '@/components/array/Surface'

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
      <SearchField label="Search muscles" inputType="search" placeholder="Search muscles…" onQueryChange={setSearch} />

      {filtered.length === 0 && (
        <EmptyState
          icon="magnifer-linear"
          title={muscles.length === 0 ? 'The reviewed guide is being prepared' : 'No matching muscles'}
          body={muscles.length === 0
            ? 'Reviewed anatomy entries will appear here as they clear the content gate.'
            : `Try a different muscle or region than "${search}".`}
        />
      )}

      {regions.map(region => (
        <section key={region} className="app-stack">
          <h2 className="t-title-2">{REGION_LABELS[region] ?? region}</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 'var(--s-12)' }}>
            {filtered.filter(m => m.region === region).map(m => (
              <SurfaceLink
                key={m.slug}
                href={`/muscles/${m.slug}`}
                tier="tile"
                style={{ minHeight: 96 }}
                innerStyle={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 'var(--s-8)', height: '100%' }}
              >
                <span data-testid={`muscle-card-${m.slug}`} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s-4)', minWidth: 0 }}>
                  <span style={{ color: 'var(--text-3)' }} aria-hidden="true"><AnatomyGlyph /></span>
                  <span className="t-headline" style={{ overflowWrap: 'anywhere' }}>{m.name}</span>
                  {!m.reviewed_at && <SeverityChip band="monitor" size="sm" label="Pending review" />}
                </span>
              </SurfaceLink>
            ))}
          </div>
        </section>
      ))}
    </>
  )
}
