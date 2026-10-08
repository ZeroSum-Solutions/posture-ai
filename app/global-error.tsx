'use client'

// This file replaces app/layout.tsx entirely when it renders (Next.js
// requirement for global-error boundaries), so app/layout.tsx's own
// `import './globals.css'` never runs here and the stylesheet — including
// the Array tokens and .t-*/.a-* utility classes — would otherwise be
// unavailable. Importing it directly makes this boundary self-sufficient
// and keeps it on the same tokens as the rest of the app instead of
// duplicating literal Array values inline.
import './globals.css'
import { ErrorState } from '@/components/ui/ErrorState'

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
        background: 'var(--background)',
        padding: '32px',
      }}>
        <ErrorState
          variant="page"
          title="Something went wrong"
          body="An unexpected error occurred. Reload the page to continue."
          onRetry={reset}
          details={error.digest ? `Reference: ${error.digest}` : undefined}
        />
      </body>
    </html>
  )
}
