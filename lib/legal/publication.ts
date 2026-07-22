import { PRODUCTION_LEGAL_DOCUMENTS } from './catalog'
import { resolveLegalDocument } from './policy'
import {
  LEGAL_CONTEXT_BY_KIND,
  type LegalDocumentKind,
} from './types'

/**
 * Publication deliberately ignores runtime fixture mode. Search engines and
 * metadata may advertise only an effective, counsel-approved production
 * document from the immutable catalog.
 */
export function isProductionLegalDocumentPublished(
  kind: LegalDocumentKind,
  at: string | Date = new Date(),
): boolean {
  return resolveLegalDocument({
    documents: PRODUCTION_LEGAL_DOCUMENTS,
    kind,
    context: LEGAL_CONTEXT_BY_KIND[kind],
    at,
  }).ok
}
