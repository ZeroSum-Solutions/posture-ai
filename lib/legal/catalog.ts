import { createHash } from 'node:crypto'

import { LEGAL_DOCUMENTS } from '@/content/legal/documents'
import { LEGAL_DOCUMENT_FIXTURES } from '@/content/legal/fixtures'
import {
  type LegalDocumentVersion,
  type LegalSection,
} from './types'

export function canonicalLegalDocumentText(
  document: Pick<LegalDocumentVersion, 'title' | 'sections'>,
): string {
  const blocks = [document.title]
  for (const section of document.sections) {
    if (section.heading) blocks.push(section.heading)
    blocks.push(...section.paragraphs)
    if (section.bullets) blocks.push(...section.bullets.map((bullet) => `- ${bullet}`))
  }
  return blocks.join('\n\n')
}

export function computeLegalDocumentHash(
  document: Pick<LegalDocumentVersion, 'title' | 'sections'>,
): string {
  return createHash('sha256')
    .update(canonicalLegalDocumentText(document), 'utf8')
    .digest('hex')
}

function freezeSection(section: LegalSection): LegalSection {
  return Object.freeze({
    ...section,
    paragraphs: Object.freeze([...section.paragraphs]),
    ...(section.bullets ? { bullets: Object.freeze([...section.bullets]) } : {}),
  })
}

function freezeCatalog(documents: readonly LegalDocumentVersion[]): readonly LegalDocumentVersion[] {
  return Object.freeze(documents.map((document) => Object.freeze({
    ...document,
    // Preserve the authored context so the resolver can reject a document whose
    // audience/jurisdiction/scope does not match the requested runtime context.
    // Replacing it with the canonical context here would silently "repair" a bad
    // source document and make the fail-closed context check impossible to trip.
    context: Object.freeze({ ...document.context }),
    sections: Object.freeze(document.sections.map(freezeSection)),
  })))
}

export const PRODUCTION_LEGAL_DOCUMENTS = freezeCatalog(LEGAL_DOCUMENTS)
export const FIXTURE_LEGAL_DOCUMENTS = freezeCatalog(LEGAL_DOCUMENT_FIXTURES)
