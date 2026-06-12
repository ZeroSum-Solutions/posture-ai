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
      <h1 style={{ fontSize: '4rem', fontWeight: 800, color: '#818CF8', marginBottom: '8px' }}>404</h1>
      <h2 style={{ fontSize: '1.25rem', fontWeight: 600, color: '#F5F5F5', marginBottom: '12px' }}>
        Page Not Found
      </h2>
      <p style={{ color: '#A1A1AA', fontSize: '0.95rem', marginBottom: '28px', maxWidth: '360px' }}>
        The page you are looking for does not exist or has been moved.
      </p>
      <Link
        href="/dashboard"
        style={{
          padding: '10px 24px',
          background: '#4F46E5',
          color: '#fff',
          borderRadius: '8px',
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
