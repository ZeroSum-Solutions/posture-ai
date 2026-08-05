import type { ElementType } from 'react'

import { Surface } from '@/components/array/Surface'
import type { LegalSnapshot } from '@/lib/legal/types'
import styles from './LegalDocumentView.module.css'

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
    <Surface tier="tile" pad={compact ? 'snug' : 'default'}>
      <article
        aria-labelledby={titleId}
        data-legal-document-id={document.documentId}
        data-legal-document-version={document.version}
        data-legal-document-body-sha256={document.bodySha256}
      >
        {document.isFixture && (
          <p role="status" aria-live="polite" className={styles.fixtureNotice}>
            NON-PRODUCTION LEGAL FIXTURE — TEST USE ONLY
          </p>
        )}

        <header className={compact ? styles.headerCompact : styles.header}>
          <Heading id={titleId} className={styles.title}>
            {document.title}
          </Heading>
          <p className={styles.meta}>
            Version {document.version} · Effective {effectiveDate}
            <br />
            Scope: {document.jurisdiction} · {document.locale} · {document.productScope}
          </p>
          <p className={styles.fingerprint}>
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
              className={compact ? styles.sectionCompact : styles.section}
            >
              {section.heading && (
                <SectionHeading id={sectionId} className={styles.sectionHeading}>
                  {section.heading}
                </SectionHeading>
              )}
              {section.paragraphs.map((paragraph, index) => (
                <p key={`${section.id}-paragraph-${index}`} className={styles.paragraph}>
                  {paragraph}
                </p>
              ))}
              {section.bullets && section.bullets.length > 0 && (
                <ul className={styles.bullets}>
                  {section.bullets.map((bullet, index) => (
                    <li key={`${section.id}-bullet-${index}`} className={styles.bullet}>{bullet}</li>
                  ))}
                </ul>
              )}
            </section>
          )
        })}
      </article>
    </Surface>
  )
}
