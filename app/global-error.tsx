'use client'

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{
        margin: 0,
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#0E1420',
        color: '#E9E7E1',
        fontFamily: 'system-ui, sans-serif',
        padding: '32px',
        textAlign: 'center',
      }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '12px' }}>
          Something went wrong
        </h1>
        <p style={{ color: '#9AA3B5', fontSize: '0.95rem', marginBottom: '28px', maxWidth: '420px' }}>
          An unexpected error occurred. Reload the page to continue.
          {error.digest ? ` (Reference: ${error.digest})` : ''}
        </p>
        <button
          onClick={reset}
          style={{
            padding: '10px 24px',
            background: '#8FA8D9',
            color: '#0E1420',
            border: 'none',
            borderRadius: '10px',
            cursor: 'pointer',
            fontWeight: 600,
            fontSize: '0.9rem',
          }}
        >
          Reload
        </button>
      </body>
    </html>
  )
}
