import Link from 'next/link'

export default function NotFound() {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '60vh',
      padding: '32px',
      textAlign: 'center',
    }}>
      <h1 className="data-readout" style={{ fontSize: '4rem', fontWeight: 300, color: 'var(--brand)', marginBottom: '8px' }}>404</h1>
      <h2 style={{ fontSize: '1.25rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '12px' }}>
        Page Not Found
      </h2>
      <p style={{ color: 'var(--text-secondary)', fontSize: '0.95rem', marginBottom: '28px', maxWidth: '360px' }}>
        The page you are looking for does not exist or has been moved.
      </p>
      <Link
        href="/dashboard"
        style={{
          padding: '10px 24px',
          background: 'var(--brand)',
          color: 'var(--background)',
          borderRadius: 'var(--radius-control, 10px)',
          textDecoration: 'none',
          fontWeight: 600,
          fontSize: '0.9rem',
        }}
      >
        Go to Dashboard
      </Link>
    </div>
  )
}
