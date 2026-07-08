export default function RouteSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading"
      style={{ maxWidth: 'var(--container-app, 1200px)', margin: '0 auto', padding: '32px 24px' }}
    >
      <div className="skeleton" style={{ height: 32, width: 260, marginBottom: 12 }} />
      <div className="skeleton" style={{ height: 16, width: 380, marginBottom: 32 }} />
      <div style={{ display: 'grid', gap: 16 }}>
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="skeleton" style={{ height: 96, borderRadius: 'var(--radius-card, 16px)' }} />
        ))}
      </div>
    </div>
  )
}
