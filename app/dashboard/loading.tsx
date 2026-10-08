import { ListRowSkeleton, Skeleton } from '@/components/ui'

/**
 * Today's loading state mirrors the final layout (DESIGN.md › Loaders): the
 * large title, the hero (count, three queue rows, the action), then a row
 * section and the week strip — not a lone spinner. Route-level `loading.tsx`
 * renders before the server component's data resolves.
 */
export default function Loading() {
  return (
    <div className="app-screen" role="status" aria-busy="true" aria-label="Loading today">
      <div className="app-screen-x" style={{ paddingTop: 'var(--s-20)' }}>
        <Skeleton shape="line" style={{ width: '40%', height: 40, marginBottom: 'var(--s-8)' }} />
        <Skeleton shape="line" style={{ width: '30%', height: 16, marginBottom: 'var(--s-24)' }} />
      </div>
      <div className="app-screen-x" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s-40)' }}>
        <Skeleton shape="row" style={{ height: 380, borderRadius: 'var(--r-lg)' }} />
        <div>
          <Skeleton shape="line" style={{ width: '35%', height: 20, marginBottom: 'var(--s-12)' }} />
          <ListRowSkeleton />
          <ListRowSkeleton />
          <ListRowSkeleton />
        </div>
      </div>
    </div>
  )
}
