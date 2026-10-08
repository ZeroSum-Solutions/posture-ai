import { ListRowSkeleton, Skeleton } from '@/components/ui'

/**
 * Clients' loading state mirrors the final layout (DESIGN.md › Loaders): a
 * large-title skeleton, the search/filter row and a group of list rows — not
 * a lone spinner. Route-level `loading.tsx` renders before any data arrives,
 * so this carries no real data of its own.
 */
export default function Loading() {
  return (
    <div className="app-screen" role="status" aria-busy="true" aria-label="Loading clients">
      <div className="app-screen-x" style={{ paddingTop: 'var(--s-20)' }}>
        <Skeleton shape="line" style={{ width: '45%', height: 34, marginBottom: 'var(--s-8)' }} />
        <Skeleton shape="line" style={{ width: '30%', height: 16, marginBottom: 'var(--s-32)' }} />
      </div>
      <div className="app-screen-x app-stack">
        <Skeleton shape="row" style={{ height: 52, borderRadius: 'var(--r-md)' }} />
        <div style={{ display: 'flex', gap: 'var(--s-8)' }}>
          <Skeleton shape="row" style={{ height: 36, width: 56, borderRadius: 'var(--r-full)' }} />
          <Skeleton shape="row" style={{ height: 36, width: 108, borderRadius: 'var(--r-full)' }} />
          <Skeleton shape="row" style={{ height: 36, width: 84, borderRadius: 'var(--r-full)' }} />
          <Skeleton shape="row" style={{ height: 36, width: 128, borderRadius: 'var(--r-full)' }} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
          <ListRowSkeleton />
          <ListRowSkeleton />
          <ListRowSkeleton />
          <ListRowSkeleton />
          <ListRowSkeleton />
        </div>
      </div>
    </div>
  )
}
