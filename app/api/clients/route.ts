import { createSupabaseServerClient, createSupabaseServiceClient } from '@/lib/supabase/server'
import { practitionerGate } from '@/lib/auth/requirePractitioner'
import { enforceRateLimit } from '@/lib/rate-limit'
import { logEvent, hashUser } from '@/lib/log'
import {
  hashConsent,
  matchesConsentDocument,
  type SubmittedConsentDocument,
} from '@/lib/consent/policy'
import { snapshotLegalDocument } from '@/lib/legal/policy'
import { resolveRuntimeLegalDocument } from '@/lib/legal/runtime'
import type { LegalSnapshot } from '@/lib/legal/types'
import {
  canonicalizeKeysetTimestamp,
  finalizeKeysetPage,
  isCanonicalUuid,
  parseKeysetPageRequest,
} from '@/lib/pagination/keyset'
import { NextRequest, NextResponse } from 'next/server'

const SIGNER_RELATIONSHIPS = new Set(['self', 'parent', 'legal_guardian', 'other'])
const ROUTE = 'POST /api/clients'
const CLIENT_LIST_SCOPE = 'clients'
const NO_STORE = { 'Cache-Control': 'private, no-store, max-age=0' }

interface ClientListRow {
  id: string
  first_name: string
  last_name: string
  date_of_birth: string | null
  created_at: string
}

function parseClientSearch(searchParams: URLSearchParams) {
  const values = searchParams.getAll('search')
  if (values.length > 1) return { ok: false as const }
  const value = (values[0] ?? '')
    .replace(/[,()%]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ')
  // The search is passed to a typed SQL function (never PostgREST's raw filter
  // grammar). Normalize common directory punctuation, and keep a small human-name
  // alphabet so wildcard characters cannot change prefix-search semantics.
  if (value.length > 100 || (value && !/^[\p{L}\p{M}\p{N}'’.\p{Pd} ]+$/u.test(value))) {
    return { ok: false as const }
  }
  return { ok: true as const, value }
}

export async function GET(req: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE })
  const gate = await practitionerGate(supabase, user.id)
  if (gate) return gate
  const userHash = hashUser(user.id)

  // One-version compatibility window: the pre-PR-09 API accepted a parameterless
  // request and returned the complete directory with the legacy field set. Current
  // callers always send `limit`. Remove this branch with the assessment-history
  // compatibility path after the window in docs/qa/pr09-performance-runbook.md.
  if (req.nextUrl.searchParams.size === 0) {
    const { data, error } = await supabase
      .from('clients')
      .select('id, first_name, last_name, date_of_birth, sex_at_birth, height_cm, weight_kg, notes, created_at')
      .is('archived_at', null)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
    if (error) {
      logEvent({ route: 'GET /api/clients', outcome: 'server_error', status: 500, userHash, detailCode: 'client_list_failed' })
      return NextResponse.json({ error: 'Failed to load clients.' }, { status: 500, headers: NO_STORE })
    }
    logEvent({ route: 'GET /api/clients', outcome: 'ok', status: 200, userHash, detailCode: 'client_list_legacy_compatibility' })
    return NextResponse.json({ clients: data ?? [], count: data?.length ?? 0 }, { headers: NO_STORE })
  }

  const parsedSearch = parseClientSearch(req.nextUrl.searchParams)
  if (!parsedSearch.ok) {
    return NextResponse.json({ error: 'Invalid search' }, { status: 400, headers: NO_STORE })
  }
  const filterKey = `search=${parsedSearch.value.toLocaleLowerCase('en-US')}`
  const parsedPage = parseKeysetPageRequest(req.nextUrl.searchParams, {
    scope: CLIENT_LIST_SCOPE,
    filterKey,
    isValidId: isCanonicalUuid,
  })
  if (!parsedPage.ok) {
    return NextResponse.json({ error: parsedPage.error }, { status: 400, headers: NO_STORE })
  }
  let page = parsedPage.value
  if (!page.after) {
    const { data: preciseSnapshot, error: snapshotError } = await supabase.rpc('current_keyset_snapshot')
    if (snapshotError || typeof preciseSnapshot !== 'string') {
      logEvent({ route: 'GET /api/clients', outcome: 'server_error', status: 500, userHash, detailCode: 'client_snapshot_failed' })
      return NextResponse.json({ error: 'Failed to load clients.' }, { status: 500, headers: NO_STORE })
    }
    try {
      page = { ...page, snapshotAt: canonicalizeKeysetTimestamp(preciseSnapshot) }
    } catch {
      logEvent({ route: 'GET /api/clients', outcome: 'server_error', status: 500, userHash, detailCode: 'client_snapshot_invalid' })
      return NextResponse.json({ error: 'Failed to load clients.' }, { status: 500, headers: NO_STORE })
    }
  }
  if (!page.snapshotAt) {
    logEvent({ route: 'GET /api/clients', outcome: 'server_error', status: 500, userHash, detailCode: 'client_snapshot_missing' })
    return NextResponse.json({ error: 'Failed to load clients.' }, { status: 500, headers: NO_STORE })
  }

  const { data, error } = await supabase.rpc('list_owned_clients_page', {
    p_search: parsedSearch.value,
    p_snapshot_at: page.snapshotAt,
    p_after_at: page.after?.at ?? null,
    p_after_id: page.after?.id ?? null,
    p_limit: page.limit + 1,
  })
  if (error) {
    logEvent({ route: 'GET /api/clients', outcome: 'server_error', status: 500, userHash, detailCode: 'client_list_failed' })
    return NextResponse.json({ error: 'Failed to load clients.' }, { status: 500, headers: NO_STORE })
  }
  const result = finalizeKeysetPage((data ?? []) as ClientListRow[], {
    scope: CLIENT_LIST_SCOPE,
    filterKey,
    snapshotAt: page.snapshotAt,
    limit: page.limit,
    // PostgREST may serialize timestamptz with `+00:00`; bind cursors to one
    // canonical UTC representation so real rows cannot create invalid cursors.
    key: (client) => ({ at: canonicalizeKeysetTimestamp(client.created_at), id: client.id }),
  })
  logEvent({ route: 'GET /api/clients', outcome: 'ok', status: 200, userHash, detailCode: 'client_list_loaded' })
  return NextResponse.json(
    { clients: result.records, count: result.records.length, pagination: result.pagination },
    { headers: NO_STORE },
  )
}

export async function POST(req: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const gate = await practitionerGate(supabase, user.id)
  if (gate) return gate
  const userHash = hashUser(user.id)

  const service = createSupabaseServiceClient()
  const allowed = await enforceRateLimit(service, { route: 'clients_create', userId: user.id, limit: 30, windowSeconds: 60 })
  if (!allowed) {
    logEvent({ route: ROUTE, outcome: 'rate_limited', status: 429, userHash })
    return NextResponse.json({ error: 'Too many requests — try again shortly.' }, { status: 429 })
  }

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const { first_name, last_name, date_of_birth, sex_at_birth, height_cm, weight_kg, notes, consent_mode, signer_name, signer_relationship } = body as {
    first_name?: string; last_name?: string; date_of_birth?: string
    sex_at_birth?: string; height_cm?: number; weight_kg?: number
    notes?: string; consent_mode?: string; signer_name?: string; signer_relationship?: string
  } & SubmittedConsentDocument
  if (!first_name || !last_name) return NextResponse.json({ error: 'first_name and last_name are required' }, { status: 400 })

  // Validate the optional demographics the same way PATCH /api/clients/[id] does, so
  // an invalid enum can't reach Postgres (which would surface as a 500 leaking the raw
  // DB error) and impossible body metrics can't persist as PHI.
  const SEX_VALUES = ['male', 'female', 'other', 'prefer_not_to_say']
  const bad = (msg: string) => NextResponse.json({ error: msg }, { status: 400 })
  if (date_of_birth != null && typeof date_of_birth !== 'string') return bad('date_of_birth must be a string or null')
  if (sex_at_birth != null && sex_at_birth !== '' && !(typeof sex_at_birth === 'string' && SEX_VALUES.includes(sex_at_birth))) {
    return bad('sex_at_birth must be one of male, female, other, prefer_not_to_say, or null')
  }
  for (const [k, v] of [['height_cm', height_cm], ['weight_kg', weight_kg]] as [string, unknown][]) {
    if (v != null && !(typeof v === 'number' && Number.isFinite(v) && v >= 0)) {
      return bad(`${k} must be a non-negative number or null`)
    }
  }

  // Consent: capture the subject's e-signature now (in-person), or create the
  // client with consent pending and send a remote link afterward. Either way the
  // subject (not just the practitioner) is the one who consents.
  const remote = consent_mode === 'remote'
  if (!remote && (!signer_name?.trim() || !signer_relationship || !SIGNER_RELATIONSHIPS.has(signer_relationship))) {
    return NextResponse.json({ error: 'Subject consent is required: provide a signer name and relationship, or choose remote consent.' }, { status: 400 })
  }

  let consentDocument: LegalSnapshot | null = null
  if (!remote) {
    const resolution = resolveRuntimeLegalDocument({ kind: 'subject_consent' })
    if (!resolution.ok) {
      return NextResponse.json(
        { error: 'Consent terms are temporarily unavailable.', code: 'legal_unavailable' },
        { status: 503 },
      )
    }
    consentDocument = snapshotLegalDocument(resolution.document)
    if (!matchesConsentDocument(consentDocument, body)) {
      return NextResponse.json(
        { error: 'The consent terms changed. Review the current terms and try again.', code: 'superseded' },
        { status: 409 },
      )
    }
  }

  const row: Record<string, unknown> = { practitioner_id: user.id, first_name, last_name }
  if (date_of_birth) row.date_of_birth = date_of_birth
  if (sex_at_birth) row.sex_at_birth = sex_at_birth
  if (height_cm != null) row.height_cm = height_cm
  if (weight_kg != null) row.weight_kg = weight_kg
  if (notes) row.notes = notes

  // Writes go through the service-role client (created above): direct DB-write
  // grants on regulated tables are revoked from `authenticated`
  // (regulatory_hardening_v2), so the API is the sole writer and the gates above
  // are the real enforcement. Ownership is set/scoped on every write since
  // service-role bypasses RLS.
  if (!remote && consentDocument) {
    const signedAt = new Date().toISOString()
    const consentHash = hashConsent({
      document: consentDocument,
      signerName: signer_name as string,
      signerRelationship: signer_relationship as string,
      signedAt,
    })
    const { data, error: cErr } = await service.rpc('create_client_with_inperson_consent_governed', {
      p_practitioner_id: user.id,
      p_first_name: first_name,
      p_last_name: last_name,
      p_date_of_birth: date_of_birth || null,
      p_sex_at_birth: sex_at_birth || null,
      p_height_cm: height_cm ?? null,
      p_weight_kg: weight_kg ?? null,
      p_notes: notes || null,
      p_document_id: consentDocument.documentId,
      p_document_version: consentDocument.version,
      p_document_body_sha256: consentDocument.bodySha256,
      p_document_effective_at: consentDocument.effectiveAt,
      p_jurisdiction: consentDocument.jurisdiction,
      p_product_scope: consentDocument.productScope,
      p_signer_name: signer_name as string,
      p_signer_relationship: signer_relationship,
      p_consent_hash: consentHash,
      p_signed_at: signedAt,
    })
    if (
      cErr
      || !data
      || typeof data !== 'object'
      || typeof (data as Record<string, unknown>).id !== 'string'
    ) {
      logEvent({ route: ROUTE, outcome: 'server_error', status: 500, userHash, detailCode: 'client_consent_enrollment_failed' })
      return NextResponse.json({ error: 'Failed to create client and record consent.' }, { status: 500 })
    }
    return NextResponse.json({ client: data }, { status: 201 })
  }

  const { data, error } = await service.from('clients').insert(row).select().single()
  if (error) {
    logEvent({ route: ROUTE, outcome: 'server_error', status: 500, userHash, detailCode: 'client_create_failed' })
    return NextResponse.json({ error: 'Failed to create client.' }, { status: 500 })
  }
  return NextResponse.json({ client: data }, { status: 201 })
}
