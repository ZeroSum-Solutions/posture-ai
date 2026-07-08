'use client'

import { useEffect } from 'react'

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error)
  }, [error])

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
      <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '12px' }}>
        Something went wrong
      </h1>
      <p style={{ color: 'var(--text-secondary)', fontSize: '0.95rem', marginBottom: '8px', maxWidth: '420px' }}>
        An unexpected error occurred while loading this page. Your data has not been affected.
      </p>
      {error.digest && (
        <p className="data-readout" style={{ color: 'var(--text-secondary)', fontSize: '0.75rem', marginBottom: '28px' }}>
          Error reference: {error.digest}
        </p>
      )}
      <button
        onClick={reset}
        style={{
          padding: '10px 24px',
          background: 'var(--brand)',
          color: 'var(--background)',
          border: 'none',
          borderRadius: 'var(--radius-control, 10px)',
          cursor: 'pointer',
          fontWeight: 600,
          fontSize: '0.9rem',
          marginTop: '16px',
        }}
      >
        Try again
      </button>
    </div>
  )
}
