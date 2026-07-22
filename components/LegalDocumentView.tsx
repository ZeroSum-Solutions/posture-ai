import type { ElementType } from 'react'

import type { LegalSnapshot } from '@/lib/legal/types'

function safeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '-')
}

export default function LegalDocumentView({
  document,
  headingLevel = 2,
  compact = false,
}: {
  document: LegalSnapshot
  headingLevel?: 1 | 2 | 3 | 4 | 5
  compact?: boolean
}) {
  const Heading = `h${headingLevel}` as ElementType
  const SectionHeading = `h${Math.min(headingLevel + 1, 6)}` as ElementType
  const titleId = `legal-title-${safeId(document.documentId)}`
  const effectiveDate = new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeZone: 'UTC',
  }).format(new Date(document.effectiveAt))

  return (
    <article
      aria-labelledby={titleId}
      data-legal-document-id={document.documentId}
      data-legal-document-version={document.version}
      data-legal-document-body-sha256={document.bodySha256}
      style={{
        padding: compact ? 14 : 20,
        border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: 10,
        background: 'var(--surface)',
        color: 'var(--text-secondary)',
      }}
    >
      {document.isFixture && (
        <p
          role="status"
          aria-live="polite"
          style={{
            margin: '0 0 14px',
            padding: '8px 10px',
            border: '1px solid rgba(255,137,24,0.45)',
            borderRadius: 6,
            color: 'var(--warning)',
            fontSize: '0.78rem',
            fontWeight: 800,
            letterSpacing: '0.04em',
          }}
        >
          NON-PRODUCTION LEGAL FIXTURE — TEST USE ONLY
        </p>
      )}

      <header style={{ marginBottom: compact ? 14 : 20 }}>
        <Heading id={titleId} style={{ margin: '0 0 8px', color: 'var(--text-primary)' }}>
          {document.title}
        </Heading>
        <p style={{ margin: 0, fontSize: '0.78rem', lineHeight: 1.6 }}>
          Version {document.version} · Effective {effectiveDate}
          <br />
          Scope: {document.jurisdiction} · {document.locale} · {document.productScope}
        </p>
        <p style={{ margin: '8px 0 0', fontSize: '0.7rem', lineHeight: 1.5, overflowWrap: 'anywhere' }}>
          Document ID: {document.documentId}
          <br />
          SHA-256: {document.bodySha256}
        </p>
      </header>

      {document.sections.map((section) => {
        const sectionId = `legal-section-${safeId(document.documentId)}-${safeId(section.id)}`
        return (
          <section
            key={section.id}
            {...(section.heading ? { 'aria-labelledby': sectionId } : {})}
            style={{ marginTop: compact ? 14 : 20 }}
          >
            {section.heading && (
              <SectionHeading
                id={sectionId}
                style={{ margin: '0 0 8px', color: 'var(--text-primary)', fontSize: '1rem' }}
              >
                {section.heading}
              </SectionHeading>
            )}
            {section.paragraphs.map((paragraph, index) => (
              <p key={`${section.id}-paragraph-${index}`} style={{ margin: '0 0 10px', lineHeight: 1.65 }}>
                {paragraph}
              </p>
            ))}
            {section.bullets && section.bullets.length > 0 && (
              <ul style={{ margin: '8px 0 10px', paddingLeft: 22 }}>
                {section.bullets.map((bullet, index) => (
                  <li key={`${section.id}-bullet-${index}`} style={{ marginBottom: 6 }}>{bullet}</li>
                ))}
              </ul>
            )}
          </section>
        )
      })}
    </article>
  )
}
