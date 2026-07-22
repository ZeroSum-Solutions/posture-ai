import {
  FIXTURE_LEGAL_DOCUMENTS,
  PRODUCTION_LEGAL_DOCUMENTS,
} from './catalog'
import { resolveLegalDocument } from './policy'
import {
  LEGAL_CONTEXT_BY_KIND,
  type LegalDocumentKind,
  type LegalResolution,
} from './types'

export type LegalRuntimeEnvironment = Readonly<Record<string, string | undefined>>

export type RuntimeLegalDocumentRequest = Readonly<{
  kind: LegalDocumentKind
  pinnedDocumentId?: string
  at?: string | Date
}>

export function isLegalFixtureMode(
  environment: LegalRuntimeEnvironment = process.env,
): boolean {
  return environment.POSTURE_TEST_MODE_ENABLED === '1'
    && environment.VERCEL_ENV !== 'production'
}

export function resolveRuntimeLegalDocument(
  request: RuntimeLegalDocumentRequest,
  environment: LegalRuntimeEnvironment = process.env,
): LegalResolution {
  const common = {
    kind: request.kind,
    context: LEGAL_CONTEXT_BY_KIND[request.kind],
    at: request.at ?? new Date(),
    ...(request.pinnedDocumentId ? { pinnedDocumentId: request.pinnedDocumentId } : {}),
  }
  const production = resolveLegalDocument({
    ...common,
    documents: PRODUCTION_LEGAL_DOCUMENTS,
  })
  if (production.ok) return production

  const mayFallBack = request.pinnedDocumentId
    ? production.code === 'unknown_pinned_document'
    : production.code === 'no_eligible_document'
  if (!mayFallBack || !isLegalFixtureMode(environment)) return production

  return resolveLegalDocument({
    ...common,
    documents: FIXTURE_LEGAL_DOCUMENTS,
    allowFixtures: true,
  })
}
