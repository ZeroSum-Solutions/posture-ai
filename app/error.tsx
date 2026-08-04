'use client'

import { useEffect } from 'react'
import Icon from '@/components/array/Icon'
import { Surface } from '@/components/array/Surface'

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <div
      className="app-screen app-screen-x"
      style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}
    >
      <Surface tier="feature">
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 12 }}>
          <Icon name="close-circle-linear" size={32} />
          <h1 className="t-headline-sm">Something went wrong</h1>
          <p className="t-body" role="alert" aria-live="assertive">
            An unexpected error occurred while loading this page. Your data has not been affected.
          </p>
          {error.digest && (
            <p className="t-quiet n">Error reference: {error.digest}</p>
          )}
          <button type="button" onClick={reset} className="a-primary" style={{ marginTop: 8 }}>
            Try again
          </button>
        </div>
      </Surface>
    </div>
  )
}
