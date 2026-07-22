import {
  canonicalLegalDocumentText,
  computeLegalDocumentHash,
} from './catalog'
import type {
  AcceptanceDecision,
  EvaluateAcceptanceRequest,
  LegalContext,
  LegalDocumentVersion,
  LegalFailureCode,
  LegalResolution,
  LegalSnapshot,
  ResolveLegalDocumentRequest,
  ResolvedLegalDocument,
} from './types'

function failure(code: LegalFailureCode, message: string): LegalResolution {
  return { ok: false, code, message }
}

function sameContext(left: LegalContext, right: LegalContext): boolean {
  return left.jurisdiction === right.jurisdiction
    && left.locale === right.locale
    && left.productScope === right.productScope
    && left.audience === right.audience
}

function timestamp(value: string | Date): number | null {
  if (value instanceof Date) {
    const result = value.getTime()
    return Number.isFinite(result) ? result : null
  }
  // Postgres/PostgREST serializes timestamptz values with an explicit offset
  // (for example +00:00), while repository-authored catalog timestamps use Z.
  // Accept those two ISO-8601 forms only; a broad Date.parse would silently
  // admit locale-dependent or date-only inputs at this evidence boundary.
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return null
  const result = Date.parse(value)
  return Number.isFinite(result) ? result : null
}

function duplicateId(documents: readonly LegalDocumentVersion[]): string | null {
  const seen = new Set<string>()
  for (const document of documents) {
    if (seen.has(document.id)) return document.id
    seen.add(document.id)
  }
  return null
}

function invalidStructure(document: LegalDocumentVersion): string | null {
  const bounded = (value: unknown, max: number) => (
    typeof value === 'string'
    && value.trim().length >= 1
    && value.trim().length <= max
  )
  if (!bounded(document.id, 128)) return 'document id must contain 1–128 characters'
  if (!bounded(document.version, 128)) return 'version must contain 1–128 characters'
  if (!bounded(document.title, 200)) return 'title must contain 1–200 characters'
  if (!Array.isArray(document.sections) || document.sections.length === 0) {
    return 'at least one content section is required'
  }
  const sectionIds = new Set<string>()
  for (const section of document.sections) {
    if (!bounded(section.id, 128)) return 'every section id must contain 1–128 characters'
    const sectionId = section.id.trim()
    if (sectionIds.has(sectionId)) return `section id ${sectionId} is duplicated`
    sectionIds.add(sectionId)
    if (section.heading !== null && !bounded(section.heading, 500)) {
      return `section ${sectionId} has an invalid heading`
    }
    if (!Array.isArray(section.paragraphs) || section.paragraphs.length === 0) {
      return `section ${sectionId} must contain at least one paragraph`
    }
    if (section.paragraphs.some((paragraph: string) => !bounded(paragraph, 20_000))) {
      return `section ${sectionId} contains an invalid paragraph`
    }
    if (section.bullets?.some((bullet: string) => !bounded(bullet, 20_000))) {
      return `section ${sectionId} contains an invalid bullet`
    }
  }
  if (!canonicalLegalDocumentText(document).trim()) return 'canonical document text is empty'
  return null
}

function validateContent(
  document: LegalDocumentVersion,
  at: number,
  allowFixtures: boolean,
): LegalResolution | null {
  const structureError = invalidStructure(document)
  if (structureError) {
    return failure('invalid_structure', `Legal document ${document.id || '<blank>'} is invalid: ${structureError}.`)
  }
  if (document.status === 'draft') {
    return failure('draft_forbidden', `Legal document ${document.id} is a draft.`)
  }
  if (document.status === 'scaffold') {
    return failure('scaffold_forbidden', `Legal document ${document.id} is scaffolding.`)
  }
  if (document.status === 'test_fixture' && !allowFixtures) {
    return failure('fixture_forbidden', `Legal document ${document.id} is a test fixture.`)
  }
  if (!document.effectiveAt) {
    return failure('missing_effective_date', `Legal document ${document.id} has no effective date.`)
  }
  const effectiveAt = timestamp(document.effectiveAt)
  if (effectiveAt === null) {
    return failure('invalid_effective_date', `Legal document ${document.id} has an invalid effective date.`)
  }
  if (effectiveAt > at) {
    return failure('not_yet_effective', `Legal document ${document.id} is not yet effective.`)
  }
  if (
    (document.status === 'approved' || document.status === 'retired')
    && !document.counselApprovalRef?.trim()
  ) {
    return failure('missing_counsel_approval', `Legal document ${document.id} lacks counsel approval.`)
  }
  if (document.bodySha256 !== computeLegalDocumentHash(document)) {
    return failure('hash_mismatch', `Legal document ${document.id} does not match its content hash.`)
  }
  return null
}

function validateSupersession(
  candidates: readonly LegalDocumentVersion[],
  scopedDocuments: readonly LegalDocumentVersion[],
): LegalResolution | null {
  const byId = new Map(scopedDocuments.map((document) => [document.id, document]))
  for (const candidate of candidates) {
    if ((candidate.supersedesId === null) !== (candidate.changeFromPrior === 'initial')) {
      return failure('invalid_supersession', `Legal document ${candidate.id} has inconsistent change metadata.`)
    }
    if (!candidate.supersedesId) continue
    const parent = byId.get(candidate.supersedesId)
    if (!parent || parent.kind !== candidate.kind || !sameContext(parent.context, candidate.context)) {
      return failure('invalid_supersession', `Legal document ${candidate.id} has an invalid predecessor.`)
    }

    const seen = new Set([candidate.id])
    let cursor: LegalDocumentVersion | undefined = parent
    while (cursor) {
      if (seen.has(cursor.id)) {
        return failure('invalid_supersession', `Legal document ${candidate.id} has a supersession cycle.`)
      }
      seen.add(cursor.id)
      cursor = cursor.supersedesId ? byId.get(cursor.supersedesId) : undefined
    }
  }
  return null
}

function resolved(document: LegalDocumentVersion): LegalResolution {
  return {
    ok: true,
    document: Object.freeze({
      ...document,
      isFixture: document.status === 'test_fixture',
    }),
  }
}

export function resolveLegalDocument(request: ResolveLegalDocumentRequest): LegalResolution {
  const repeatedId = duplicateId(request.documents)
  if (repeatedId) {
    return failure('duplicate_document_id', `Legal document id ${repeatedId} is duplicated.`)
  }

  const at = timestamp(request.at)
  if (at === null) return failure('invalid_effective_date', 'The resolution timestamp is invalid.')
  const allowFixtures = request.allowFixtures === true

  if (request.pinnedDocumentId) {
    const pinned = request.documents.find((document) => document.id === request.pinnedDocumentId)
    if (!pinned) {
      return failure('unknown_pinned_document', `Pinned legal document ${request.pinnedDocumentId} was not found.`)
    }
    if (pinned.kind !== request.kind) {
      return failure('kind_mismatch', `Pinned legal document ${pinned.id} has the wrong kind.`)
    }
    if (!sameContext(pinned.context, request.context)) {
      return failure('context_mismatch', `Pinned legal document ${pinned.id} has the wrong context.`)
    }
    const invalid = validateContent(pinned, at, allowFixtures)
    return invalid ?? resolved(pinned)
  }

  const sameKind = request.documents.filter((document) => document.kind === request.kind)
  if (sameKind.length === 0) {
    return failure('no_eligible_document', 'No legal document exists for the requested kind.')
  }
  const scoped = sameKind.filter((document) => sameContext(document.context, request.context))
  if (scoped.length === 0) {
    return failure('context_mismatch', 'No legal document matches the requested context.')
  }

  const active = scoped.filter((document) => (
    document.status === 'approved'
    || (document.status === 'test_fixture' && allowFixtures)
  ))
  if (active.length === 0) {
    if (scoped.some((document) => document.status === 'test_fixture')) {
      return failure('fixture_forbidden', 'Test fixtures require explicit authorization.')
    }
    if (scoped.some((document) => document.status === 'scaffold')) {
      return failure('scaffold_forbidden', 'Scaffold legal documents cannot be resolved.')
    }
    if (scoped.some((document) => document.status === 'draft')) {
      return failure('draft_forbidden', 'Draft legal documents cannot be resolved.')
    }
    return failure('no_eligible_document', 'No active legal document matches the requested context.')
  }

  const eligible: LegalDocumentVersion[] = []
  let futureFailure: LegalResolution | null = null
  for (const candidate of active) {
    const invalid = validateContent(candidate, at, allowFixtures)
    if (invalid && !invalid.ok && invalid.code === 'not_yet_effective') {
      futureFailure ??= invalid
      continue
    }
    if (invalid) return invalid
    eligible.push(candidate)
  }
  if (eligible.length === 0) {
    return futureFailure ?? failure('no_eligible_document', 'No effective legal document is eligible.')
  }

  const invalidChain = validateSupersession(eligible, scoped)
  if (invalidChain) return invalidChain
  const superseded = new Set(eligible.flatMap((document) => (
    document.supersedesId ? [document.supersedesId] : []
  )))
  const heads = eligible.filter((document) => !superseded.has(document.id))
  if (heads.length !== 1) {
    return failure('ambiguous_eligible_versions', 'The legal catalog does not have one active version head.')
  }
  return resolved(heads[0])
}

function acceptance(state: AcceptanceDecision['state'], reason: string): AcceptanceDecision {
  return { state, reason }
}

export function evaluateAcceptance(request: EvaluateAcceptanceRequest): AcceptanceDecision {
  const { requiredDocument, evidence, documents } = request
  if (!requiredDocument.acceptanceRequired) {
    return acceptance('current', 'This document does not require acceptance.')
  }
  if (!evidence) return acceptance('missing', 'No acceptance evidence exists.')
  if (evidence.state === 'withdrawn') return acceptance('withdrawn', 'The acceptance was withdrawn.')
  if (!evidence.documentId || !evidence.bodySha256 || !evidence.acceptedAt) {
    return acceptance('legacy_unverified', 'Legacy acceptance lacks versioned evidence.')
  }
  const acceptedAt = timestamp(evidence.acceptedAt)
  if (acceptedAt === null) return acceptance('legacy_unverified', 'The acceptance timestamp is invalid.')
  if (duplicateId(documents)) return acceptance('legacy_unverified', 'The legal history contains duplicate ids.')

  const acceptedDocument = documents.find((document) => document.id === evidence.documentId)
  if (
    !acceptedDocument
    || invalidStructure(acceptedDocument) !== null
    || acceptedDocument.bodySha256 !== evidence.bodySha256
    || acceptedDocument.bodySha256 !== computeLegalDocumentHash(acceptedDocument)
  ) {
    return acceptance('legacy_unverified', 'The accepted document or hash cannot be verified.')
  }
  const acceptedEffectiveAt = acceptedDocument.effectiveAt
    ? timestamp(acceptedDocument.effectiveAt)
    : null
  if (acceptedEffectiveAt === null || acceptedAt < acceptedEffectiveAt) {
    return acceptance('legacy_unverified', 'The acceptance predates the accepted document.')
  }
  if (
    acceptedDocument.kind !== requiredDocument.kind
    || !sameContext(acceptedDocument.context, requiredDocument.context)
  ) {
    return acceptance('reconsent_required', 'The acceptance belongs to a different legal context.')
  }
  if (
    acceptedDocument.id === requiredDocument.id
    && acceptedDocument.bodySha256 === requiredDocument.bodySha256
  ) {
    return acceptance('current', 'The required document version was accepted.')
  }

  const byId = new Map(documents.map((document) => [document.id, document]))
  const seen = new Set<string>()
  let cursor: LegalDocumentVersion | undefined = requiredDocument
  while (cursor.supersedesId) {
    if (seen.has(cursor.id)) {
      return acceptance('reconsent_required', 'The legal history contains a supersession cycle.')
    }
    seen.add(cursor.id)
    if (cursor.changeFromPrior === 'material') {
      return acceptance('reconsent_required', 'A material legal change requires new acceptance.')
    }
    if (cursor.supersedesId === acceptedDocument.id) {
      return acceptance('current', 'Only non-material changes followed the accepted version.')
    }
    cursor = byId.get(cursor.supersedesId)
    if (!cursor) break
  }
  return acceptance('reconsent_required', 'The accepted version is not in the current supersession chain.')
}

export function snapshotLegalDocument(document: ResolvedLegalDocument): LegalSnapshot {
  if (!document.effectiveAt) throw new Error(`Resolved legal document ${document.id} has no effective date.`)
  const sections = Object.freeze(document.sections.map((section) => Object.freeze({
    ...section,
    paragraphs: Object.freeze([...section.paragraphs]),
    ...(section.bullets ? { bullets: Object.freeze([...section.bullets]) } : {}),
  })))
  return Object.freeze({
    schemaVersion: 1,
    documentId: document.id,
    kind: document.kind,
    version: document.version,
    title: document.title,
    effectiveAt: document.effectiveAt,
    jurisdiction: document.context.jurisdiction,
    locale: document.context.locale,
    productScope: document.context.productScope,
    audience: document.context.audience,
    bodySha256: document.bodySha256,
    text: canonicalLegalDocumentText(document),
    sections,
    isFixture: document.isFixture,
  })
}
