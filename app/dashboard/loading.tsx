import { CardSkeleton, ListRowSkeleton, Skeleton } from '@/components/ui'

/**
 * Today's loading state mirrors the final layout (DESIGN.md › Loaders): a
 * large-title skeleton, the hero card, two row groups and the stats strip —
 * not a lone spinner. Route-level `loading.tsx` renders before the server
 * component's data resolves, so this carries no real data of its own.
 */
export default function Loading() {
  return (
    <div className="app-screen" role="status" aria-busy="true" aria-label="Loading today">
      <div className="app-screen-x" style={{ paddingTop: 'var(--s-20)' }}>
        <Skeleton shape="line" style={{ width: '40%', height: 34, marginBottom: 'var(--s-8)' }} />
        <Skeleton shape="line" style={{ width: '55%', height: 16, marginBottom: 'var(--s-32)' }} />
      </div>
      <div className="app-screen-x app-stack">
        <CardSkeleton />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
          <ListRowSkeleton />
          <ListRowSkeleton />
          <ListRowSkeleton />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
          <ListRowSkeleton />
          <ListRowSkeleton />
        </div>
      </div>
    </div>
  )
}
