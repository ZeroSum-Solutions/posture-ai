'use client'

// This file replaces app/layout.tsx entirely when it renders (Next.js
// requirement for global-error boundaries), so app/layout.tsx's own
// `import './globals.css'` never runs here and the stylesheet — including
// the Array tokens and .t-*/.a-* utility classes — would otherwise be
// unavailable. Importing it directly makes this boundary self-sufficient
// and keeps it on the same tokens as the rest of the app instead of
// duplicating literal Array values inline.
import './globals.css'

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
        textAlign: 'center',
      }}>
        <h1 className="t-title-2" style={{ marginBottom: '12px' }}>
          Something went wrong
        </h1>
        <p className="t-body" style={{ marginBottom: '28px', maxWidth: '420px' }}>
          An unexpected error occurred. Reload the page to continue.
          {error.digest ? ` (Reference: ${error.digest})` : ''}
        </p>
        <button onClick={reset} className="a-primary">
          Reload
        </button>
      </body>
    </html>
  )
}
