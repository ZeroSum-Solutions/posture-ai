import type { ElementType } from 'react'

import { Surface } from '@/components/array/Surface'
import { Disclosure } from '@/components/ui/Disclosure'
import type { LegalSnapshot } from '@/lib/legal/types'
import styles from './LegalDocumentView.module.css'

function safeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '-')
}

const TITLE_CLASS: Record<1 | 2 | 3 | 4 | 5 | 6, string> = {
  1: 't-display',
  2: 't-title-2',
  3: 't-headline',
  4: 't-headline',
  5: 't-headline',
  6: 't-headline',
}

export default function LegalDocumentView({
  document,
  headingLevel = 2,
  headingBase,
  compact = false,
  collapseFingerprint = false,
  showToc = false,
}: {
  document: LegalSnapshot
  headingLevel?: 1 | 2 | 3 | 4 | 5
  /**
   * Preferred name for `headingLevel` (spec §5 "Legal pages": the embedded
   * document's headings sit below the page's own `h1`). Additive — existing
   * callers passing `headingLevel` are unaffected; this wins when both are
   * given.
   */
  headingBase?: 1 | 2 | 3 | 4 | 5
  compact?: boolean
  /**
   * Wraps version/effective-date/scope and the id+hash fingerprint in a
   * collapsed "Document details" Disclosure instead of showing them inline
   * (spec §4 first-run — the worst contrast cluster). Additive and opt-in:
   * existing callers (e.g. WorkoutPlayer's `WorkoutLegalNotice`) keep the
   * always-visible metadata layout, just recoloured off `--text-quiet` onto
   * `--text-3` either way, which is what actually fixes audit #3's 2.46:1
   * failure — the Disclosure is a decluttering choice on top of that, made
   * by the screens migrating to it (Legal pages, Onboarding, Consent).
   */
  collapseFingerprint?: boolean
  /**
   * Renders a "Contents" Disclosure of jump links to each heading, when the
   * document has any (spec §5 "Legal pages"). Additive and opt-in.
   */
  showToc?: boolean
}) {
  const level = headingBase ?? headingLevel
  const Heading = `h${level}` as ElementType
  const sectionLevel = Math.min(level + 1, 6) as 1 | 2 | 3 | 4 | 5 | 6
  const SectionHeading = `h${sectionLevel}` as ElementType
  const titleId = `legal-title-${safeId(document.documentId)}`
  const effectiveDate = new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeZone: 'UTC',
  }).format(new Date(document.effectiveAt))
  const sectionsWithIds = document.sections.map((section) => ({
    section,
    sectionId: `legal-section-${safeId(document.documentId)}-${safeId(section.id)}`,
  }))
  const headedSections = sectionsWithIds.filter(({ section }) => section.heading)

  return (
    <Surface tier="tile" pad={compact ? 'snug' : 'default'}>
      <article
        aria-labelledby={titleId}
        data-legal-document-id={document.documentId}
        data-legal-document-version={document.version}
        data-legal-document-body-sha256={document.bodySha256}
        className={styles.column}
      >
        {document.isFixture && (
          <p role="status" aria-live="polite" className={`t-caption ${styles.fixtureNotice}`}>
            NON-PRODUCTION LEGAL FIXTURE — TEST USE ONLY
          </p>
        )}

        <header className={compact ? styles.headerCompact : styles.header}>
          <Heading id={titleId} className={TITLE_CLASS[level]}>
            {document.title}
          </Heading>
          {/* The fingerprint (id + hash) and version/date/scope metadata were
              --text-quiet (2.46:1, audit #3's worst contrast failure); both
              now read --text-3 regardless of collapseFingerprint. */}
          {collapseFingerprint ? (
            <div className={styles.details}>
              <Disclosure title="Document details">
                <p className={`t-footnote ${styles.meta}`}>
                  Version {document.version} · Effective {effectiveDate}
                  <br />
                  Scope: {document.jurisdiction} · {document.locale} · {document.productScope}
                </p>
                <p className={`t-footnote ${styles.fingerprint}`}>
                  Document ID: {document.documentId}
                  <br />
                  SHA-256: {document.bodySha256}
                </p>
              </Disclosure>
            </div>
          ) : (
            <>
              <p className={`t-footnote ${styles.meta}`}>
                Version {document.version} · Effective {effectiveDate}
                <br />
                Scope: {document.jurisdiction} · {document.locale} · {document.productScope}
              </p>
              <p className={`t-footnote ${styles.fingerprint}`}>
                Document ID: {document.documentId}
                <br />
                SHA-256: {document.bodySha256}
              </p>
            </>
          )}
        </header>

        {showToc && headedSections.length > 0 && (
          <div className={styles.toc}>
            <Disclosure title="Contents">
              <nav aria-label="Document sections">
                <ul className={styles.tocList}>
                  {headedSections.map(({ section, sectionId }) => (
                    <li key={section.id}>
                      <a href={`#${sectionId}`} className="t-body">{section.heading}</a>
                    </li>
                  ))}
                </ul>
              </nav>
            </Disclosure>
          </div>
        )}

        {sectionsWithIds.map(({ section, sectionId }) => {
          return (
            <section
              key={section.id}
              {...(section.heading ? { 'aria-labelledby': sectionId } : {})}
              className={compact ? styles.sectionCompact : styles.section}
            >
              {section.heading && (
                <SectionHeading id={sectionId} className="t-headline">
                  {section.heading}
                </SectionHeading>
              )}
              {section.paragraphs.map((paragraph, index) => (
                <p key={`${section.id}-paragraph-${index}`} className={`t-body ${styles.paragraph}`}>
                  {paragraph}
                </p>
              ))}
              {section.bullets && section.bullets.length > 0 && (
                <ul className={styles.bullets}>
                  {section.bullets.map((bullet, index) => (
                    <li key={`${section.id}-bullet-${index}`} className={`t-body ${styles.bullet}`}>{bullet}</li>
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
