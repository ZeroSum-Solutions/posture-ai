'use client'

// Dev-only gallery for the v4 data & severity components (not shipped).
import { useState } from 'react'
import { notFound } from 'next/navigation'
import { FilterTiles, FindingMatrix, FindingReadout, ScoreScale, SeverityChip, TrendPlot, type TileBand } from '@/components/ui'

export default function DataKit() {
  if (process.env.NODE_ENV === 'production') notFound()
  const [tile, setTile] = useState<TileBand | null>(null)
  return (
    <main className="app-screen app-screen-x" style={{ display: 'flex', flexDirection: 'column', gap: 40, paddingTop: 56 }}>
      <header>
        <p className="t-micro">Screening · 7 Sep · Alice Smith</p>
        <h1 className="t-display">Results</h1>
      </header>
      <ScoreScale score={22} previous={{ score: 31, date: '14 Aug' }} />
      <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <h2 className="t-headline">9 findings</h2>
        <FilterTiles counts={{ review: 0, monitor: 4, maintain: 5 }} selected={tile} onSelect={setTile} />
      </section>
      <section>
        <FindingReadout name="Forward head posture" value={14.2} unit="°" band="monitor" scale={{ warn: 10, danger: 20 }} previous={{ value: 16.1, date: '14 Aug' }} animate />
        <hr style={{ border: 0, borderTop: '1px solid var(--hairline)' }} />
        <FindingReadout name="Shoulder imbalance (back)" value={2.4} unit="cm" band="maintain" scale={{ warn: 3, danger: 6 }} animate />
        <hr style={{ border: 0, borderTop: '1px solid var(--hairline)' }} />
        <FindingReadout name="Pelvic rotation" value={null} unit="°" band="neutral" />
      </section>
      <section>
        <h2 className="t-headline" style={{ marginBottom: 12 }}>Change over time</h2>
        <TrendPlot points={[
          { id: 'a', date: '2026-05-02', score: 48 },
          { id: 'b', date: '2026-06-10', score: 41 },
          { id: 'c', date: '2026-07-01', score: 35, flag: 'Camera level not verified' },
          { id: 'd', date: '2026-08-14', score: 31 },
          { id: 'e', date: '2026-09-07', score: 22 },
        ]} />
      </section>
      <section>
        <h2 className="t-headline" style={{ marginBottom: 12 }}>Findings over time</h2>
        <FindingMatrix
          findings={[{ key: 'fhp', name: 'Forward head' }, { key: 'sib', name: 'Shoulder (back)' }, { key: 'knl', name: 'Knee alignment L' }, { key: 'pob', name: 'Pelvic obliquity' }]}
          scans={[{ id: 'e', label: '7 Sep' }, { id: 'd', label: '14 Aug' }, { id: 'c', label: '1 Jul' }, { id: 'b', label: '10 Jun' }]}
          cells={{
            fhp: { e: { band: 'monitor' }, d: { band: 'monitor' }, c: { band: 'review' }, b: { band: 'review' } },
            sib: { e: { band: 'maintain' }, d: { band: 'monitor' }, c: { band: 'monitor' }, b: null },
            knl: { e: { band: 'maintain' }, d: { band: 'maintain' }, c: { band: 'maintain' }, b: { band: 'monitor' } },
            pob: { e: { band: 'maintain' }, d: null, c: { band: 'maintain' }, b: { band: 'maintain' } },
          }}
          onCell={() => {}}
        />
      </section>
      <section style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
        <SeverityChip band="maintain" /><SeverityChip band="monitor" /><SeverityChip band="review" /><SeverityChip band="neutral" />
      </section>
    </main>
  )
}
