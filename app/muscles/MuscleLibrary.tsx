'use client'
import { useState, type CSSProperties } from 'react'
import Link from 'next/link'
import Icon from '@/components/array/Icon'
import { ChipRow, EmptyState, FilterChip, SearchField } from '@/components/ui'
import styles from './Muscles.module.css'

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

/**
 * Muscle guide index (Array v4): search, a bleed row of region chips (tap to
 * narrow, tap again for all), then head-to-toe region groups of hairline rows —
 * name, one line of what it does, chevron. No tile per muscle.
 */
export function MuscleLibrary({ muscles }: { muscles: MuscleRow[] }) {
  const [search, setSearch] = useState('')
  const [regionFilter, setRegionFilter] = useState<string | null>(null)

  const q = search.trim().toLowerCase()
  const matching = q
    ? muscles.filter(m => m.name.toLowerCase().includes(q) || m.region.replace('_', ' ').includes(q))
    : muscles
  const filtered = regionFilter ? matching.filter(m => m.region === regionFilter) : matching
  const availableRegions = REGION_ORDER.filter(r => muscles.some(m => m.region === r))
  const regions = REGION_ORDER.filter(r => filtered.some(m => m.region === r))
  let order = 0

  return (
    <>
      <div className={styles.controls}>
        <SearchField label="Search muscles" inputType="search" placeholder="Search muscles…" onQueryChange={setSearch} />
        {availableRegions.length > 1 ? (
          <ChipRow label="Filter muscles by region" bleed>
            {availableRegions.map(region => (
              <FilterChip
                key={region}
                label={REGION_LABELS[region] ?? region}
                count={matching.filter(m => m.region === region).length}
                selected={regionFilter === region}
                onToggle={() => setRegionFilter(current => (current === region ? null : region))}
              />
            ))}
          </ChipRow>
        ) : null}
      </div>

      {filtered.length === 0 && (
        <EmptyState
          icon="magnifer-linear"
          variant="inline"
          title={muscles.length === 0 ? 'The reviewed guide is being prepared' : 'No matching muscles'}
          body={muscles.length === 0
            ? 'Reviewed anatomy entries will appear here as they clear the content gate.'
            : `Try a different muscle or region than "${search}".`}
        />
      )}

      {regions.map(region => {
        const rows = filtered.filter(m => m.region === region)
        return (
          <section key={region} className={styles.region} aria-labelledby={`region-${region}`}>
            <header className={styles.regionHead}>
              <h2 id={`region-${region}`} className="t-headline">{REGION_LABELS[region] ?? region}</h2>
              <span className={styles.regionCount}>{rows.length}</span>
            </header>
            <ul className={styles.rows}>
              {rows.map(m => {
                const i = Math.min(order++, 8)
                return (
                  <li key={m.slug} style={{ '--i': i } as CSSProperties}>
                    <Link href={`/muscles/${m.slug}`} className={styles.row} data-testid={`muscle-card-${m.slug}`}>
                      <span className={styles.rowText}>
                        <span className={styles.rowTitle}>{m.name}</span>
                        <span className={styles.rowMeta}>{m.function_text}</span>
                        {!m.reviewed_at && <span className={styles.pending}>Pending review</span>}
                      </span>
                      <Icon name="alt-arrow-right-linear" size={20} />
                    </Link>
                  </li>
                )
              })}
            </ul>
          </section>
        )
      })}
    </>
  )
}
