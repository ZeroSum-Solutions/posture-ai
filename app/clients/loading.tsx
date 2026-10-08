import { Skeleton } from '@/components/ui'

/**
 * Clients' loading state mirrors the final layout (DESIGN.md › Loaders): the
 * large title, the search field and filter chips, then avatar rows on the
 * canvas — not a lone spinner. Route-level `loading.tsx` renders before any
 * data arrives, so this carries no real data of its own.
 */
export default function Loading() {
  return (
    <div className="app-screen" role="status" aria-busy="true" aria-label="Loading clients">
      <div className="app-screen-x" style={{ paddingTop: 'var(--s-20)' }}>
        <Skeleton shape="line" style={{ width: '45%', height: 40, marginBottom: 'var(--s-8)' }} />
        <Skeleton shape="line" style={{ width: '25%', height: 16, marginBottom: 'var(--s-24)' }} />
      </div>
      <div className="app-screen-x" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s-12)' }}>
        <Skeleton shape="row" style={{ height: 52, borderRadius: 'var(--r-full)' }} />
        <div style={{ display: 'flex', gap: 'var(--s-8)' }}>
          <Skeleton shape="row" style={{ height: 44, width: 84, borderRadius: 'var(--r-full)' }} />
          <Skeleton shape="row" style={{ height: 44, width: 136, borderRadius: 'var(--r-full)' }} />
          <Skeleton shape="row" style={{ height: 44, width: 108, borderRadius: 'var(--r-full)' }} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', marginTop: 'var(--s-24)' }}>
          {[62, 48, 70, 54, 66].map((width, index) => (
            <div key={index} style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-12)', minHeight: 72 }}>
              <Skeleton shape="row" style={{ width: 40, height: 40, borderRadius: 'var(--r-full)' }} />
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 'var(--s-8)' }}>
                <Skeleton shape="line" style={{ width: `${width}%`, height: 16 }} />
                <Skeleton shape="line" style={{ width: '38%', height: 12 }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
