'use client'

import { useEffect } from 'react'
import { ErrorState } from '@/components/ui'

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <div
      className="app-screen app-screen-x"
      style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}
    >
      <ErrorState
        variant="page"
        title="Something went wrong"
        body="An unexpected error occurred while loading this page. Your data has not been affected."
        onRetry={reset}
        details={error.digest ? `Error reference: ${error.digest}` : undefined}
      />
    </div>
  )
}
