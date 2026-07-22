export const LEGAL_JURISDICTION = 'US' as const
export const LEGAL_LOCALE = 'en-US' as const
export const LEGAL_PRODUCT_SCOPE = 'us_fitness_wellness_assessment_beta_v1' as const

export type LegalDocumentKind =
  | 'privacy'
  | 'terms'
  | 'subject_consent'
  | 'screening_notice'

export type LegalAudience = 'public' | 'practitioner' | 'subject'

export type LegalDocumentStatus =
  | 'draft'
  | 'scaffold'
  | 'test_fixture'
  | 'approved'
  | 'retired'

export type LegalChangeKind = 'initial' | 'non_material' | 'material'

export type LegalContext = Readonly<{
  jurisdiction: typeof LEGAL_JURISDICTION
  locale: typeof LEGAL_LOCALE
  productScope: typeof LEGAL_PRODUCT_SCOPE
  audience: LegalAudience
}>

export type LegalSection = Readonly<{
  id: string
  heading: string | null
  paragraphs: readonly string[]
  bullets?: readonly string[]
}>

export type LegalDocumentVersion = Readonly<{
  id: string
  kind: LegalDocumentKind
  version: string
  status: LegalDocumentStatus
  title: string
  context: LegalContext
  effectiveAt: string | null
  sections: readonly LegalSection[]
  bodySha256: string
  supersedesId: string | null
  changeFromPrior: LegalChangeKind
  acceptanceRequired: boolean
  counselApprovalRef: string | null
}>

export type ResolvedLegalDocument = LegalDocumentVersion & Readonly<{
  isFixture: boolean
}>

export type LegalFailureCode =
  | 'duplicate_document_id'
  | 'invalid_structure'
  | 'unknown_pinned_document'
  | 'kind_mismatch'
  | 'context_mismatch'
  | 'draft_forbidden'
  | 'scaffold_forbidden'
  | 'fixture_forbidden'
  | 'missing_effective_date'
  | 'invalid_effective_date'
  | 'not_yet_effective'
  | 'missing_counsel_approval'
  | 'hash_mismatch'
  | 'no_eligible_document'
  | 'ambiguous_eligible_versions'
  | 'invalid_supersession'

export type LegalResolution =
  | Readonly<{ ok: true; document: ResolvedLegalDocument }>
  | Readonly<{ ok: false; code: LegalFailureCode; message: string }>

export type ResolveLegalDocumentRequest = Readonly<{
  documents: readonly LegalDocumentVersion[]
  kind: LegalDocumentKind
  context: LegalContext
  at: string | Date
  pinnedDocumentId?: string
  allowFixtures?: boolean
}>

export type LegalAcceptanceEvidence = Readonly<{
  state: 'accepted' | 'withdrawn'
  documentId: string | null
  bodySha256: string | null
  acceptedAt: string | null
}>

export type LegalAcceptanceState =
  | 'current'
  | 'missing'
  | 'withdrawn'
  | 'reconsent_required'
  | 'legacy_unverified'

export type AcceptanceDecision = Readonly<{
  state: LegalAcceptanceState
  reason: string
}>

export type EvaluateAcceptanceRequest = Readonly<{
  requiredDocument: ResolvedLegalDocument
  evidence: LegalAcceptanceEvidence | null | undefined
  documents: readonly LegalDocumentVersion[]
}>

export type LegalSnapshot = Readonly<{
  schemaVersion: 1
  documentId: string
  kind: LegalDocumentKind
  version: string
  title: string
  effectiveAt: string
  jurisdiction: typeof LEGAL_JURISDICTION
  locale: typeof LEGAL_LOCALE
  productScope: typeof LEGAL_PRODUCT_SCOPE
  audience: LegalAudience
  bodySha256: string
  text: string
  sections: readonly LegalSection[]
  isFixture: boolean
}>

export const LEGAL_CONTEXT_BY_KIND: Readonly<Record<LegalDocumentKind, LegalContext>> = Object.freeze({
  privacy: Object.freeze({
    jurisdiction: LEGAL_JURISDICTION,
    locale: LEGAL_LOCALE,
    productScope: LEGAL_PRODUCT_SCOPE,
    audience: 'public',
  }),
  terms: Object.freeze({
    jurisdiction: LEGAL_JURISDICTION,
    locale: LEGAL_LOCALE,
    productScope: LEGAL_PRODUCT_SCOPE,
    audience: 'practitioner',
  }),
  subject_consent: Object.freeze({
    jurisdiction: LEGAL_JURISDICTION,
    locale: LEGAL_LOCALE,
    productScope: LEGAL_PRODUCT_SCOPE,
    audience: 'subject',
  }),
  screening_notice: Object.freeze({
    jurisdiction: LEGAL_JURISDICTION,
    locale: LEGAL_LOCALE,
    productScope: LEGAL_PRODUCT_SCOPE,
    audience: 'public',
  }),
})
