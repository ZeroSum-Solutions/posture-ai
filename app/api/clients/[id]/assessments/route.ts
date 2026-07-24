import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { practitionerGate } from '@/lib/auth/requirePractitioner'
import { hashResource, hashUser, logEvent } from '@/lib/log'
import {
  CLIENT_ASSESSMENT_LIST_SCOPE,
  clientAssessmentHistoryFilterKey,
} from '@/lib/clients/assessment-history'
import {
  canonicalizeKeysetTimestamp,
  finalizeKeysetPage,
  isCanonicalIsoTimestamp,
  isCanonicalUuid,
  parseKeysetPageRequest,
} from '@/lib/pagination/keyset'

const NO_STORE = { 'Cache-Control': 'private, no-store, max-age=0' }

function singleParam(searchParams: URLSearchParams, key: string) {
  const values = searchParams.getAll(key)
  return values.length <= 1 ? { ok: true as const, value: values[0] ?? null } : { ok: false as const }
}

function booleanParam(searchParams: URLSearchParams, key: string) {
  const parsed = singleParam(searchParams, key)
  if (!parsed.ok || (parsed.value !== null && parsed.value !== 'true' && parsed.value !== 'false')) {
    return { ok: false as const }
  }
  return { ok: true as const, value: parsed.value === 'true' }
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE })
  const gate = await practitionerGate(supabase, user.id)
  if (gate) return gate

  const { id: clientId } = await params
  const exclude = singleParam(req.nextUrl.searchParams, 'exclude')
  const includeFindingsParam = booleanParam(req.nextUrl.searchParams, 'include_findings')
  // Opt-in: the PDF comparison picker only offers approved priors (an unapproved
  // one would 403 on export). The progress chart leaves this off to show all.
  const approvedOnlyParam = booleanParam(req.nextUrl.searchParams, 'approved_only')
  const beforeAtParam = singleParam(req.nextUrl.searchParams, 'before_at')
  if (
    !exclude.ok
    || !includeFindingsParam.ok
    || !approvedOnlyParam.ok
    || !beforeAtParam.ok
    || (exclude.value !== null && (exclude.value.length > 200 || !/^[A-Za-z0-9-]+$/.test(exclude.value)))
    || (beforeAtParam.value !== null && !isCanonicalIsoTimestamp(beforeAtParam.value))
  ) {
    return NextResponse.json({ error: 'Invalid assessment history filters' }, { status: 400, headers: NO_STORE })
  }
  const excludeId = exclude.value
  const includeFindings = includeFindingsParam.value
  const approvedOnly = approvedOnlyParam.value
  const beforeAt = beforeAtParam.value
  const boundedRequest = req.nextUrl.searchParams.has('limit')
  if (!boundedRequest && req.nextUrl.searchParams.has('cursor')) {
    return NextResponse.json({ error: 'A cursor requires an explicit limit' }, { status: 400, headers: NO_STORE })
  }
  const filterKey = clientAssessmentHistoryFilterKey({
    clientId,
    excludeId,
    includeFindings,
    approvedOnly,
    beforeAt,
  })
  const parsedPage = boundedRequest
    ? parseKeysetPageRequest(req.nextUrl.searchParams, {
        scope: CLIENT_ASSESSMENT_LIST_SCOPE,
        filterKey,
        isValidId: isCanonicalUuid,
      })
    : null
  if (parsedPage && !parsedPage.ok) {
    return NextResponse.json({ error: parsedPage.error }, { status: 400, headers: NO_STORE })
  }
  let page = parsedPage?.ok ? parsedPage.value : null

  // Verify client belongs to this practitioner
  const { data: client, error: clientError } = await supabase
    .from('clients')
    .select('id')
    .eq('id', clientId)
    .eq('practitioner_id', user.id)
    .maybeSingle()

  if (clientError) {
    logEvent({
      route: 'GET /api/clients/[id]/assessments',
      outcome: 'server_error',
      status: 500,
      userHash: hashUser(user.id),
      resourceHash: hashResource(clientId),
      detailCode: 'client_ownership_check_failed',
    })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500, headers: NO_STORE })
  }

  if (!client) {
    return NextResponse.json({ error: 'Client not found' }, { status: 404, headers: NO_STORE })
  }

  if (page && !page.after) {
    const { data: preciseSnapshot, error: snapshotError } = await supabase.rpc('current_keyset_snapshot')
    if (snapshotError || typeof preciseSnapshot !== 'string') {
      logEvent({
        route: 'GET /api/clients/[id]/assessments',
        outcome: 'server_error',
        status: 500,
        userHash: hashUser(user.id),
        resourceHash: hashResource(clientId),
        detailCode: 'assessment_snapshot_failed',
      })
      return NextResponse.json({ error: 'Internal server error' }, { status: 500, headers: NO_STORE })
    }
    try {
      page = { ...page, snapshotAt: canonicalizeKeysetTimestamp(preciseSnapshot) }
    } catch {
      logEvent({
        route: 'GET /api/clients/[id]/assessments',
        outcome: 'server_error',
        status: 500,
        userHash: hashUser(user.id),
        resourceHash: hashResource(clientId),
        detailCode: 'assessment_snapshot_invalid',
      })
      return NextResponse.json({ error: 'Internal server error' }, { status: 500, headers: NO_STORE })
    }
  }
  if (page && !page.snapshotAt) {
    logEvent({
      route: 'GET /api/clients/[id]/assessments',
      outcome: 'server_error',
      status: 500,
      userHash: hashUser(user.id),
      resourceHash: hashResource(clientId),
      detailCode: 'assessment_snapshot_missing',
    })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500, headers: NO_STORE })
  }
  const boundedPage = page?.snapshotAt
    ? { ...page, snapshotAt: page.snapshotAt }
    : null

  let query = supabase
    .from('assessments')
    .select(
      includeFindings
        ? 'id, assessed_at, overall_grade, overall_score, status, scoring_engine_version, assessment_findings(imbalance_key, label, severity_pct, zone, region, deviation, standard, unit)'
        : 'id, assessed_at, overall_grade, overall_score, status, scoring_engine_version'
    )
    .eq('client_id', clientId)
    .eq('practitioner_id', user.id)
    .eq('status', 'complete')

  if (excludeId) {
    query = query.neq('id', excludeId)
  }
  if (approvedOnly) {
    query = query.eq('practitioner_approved', true)
  }
  if (beforeAt) {
    query = query.lt('assessed_at', beforeAt)
  }
  if (boundedPage?.after) {
    query = query.or(
      `assessed_at.lt.${boundedPage.after.at},and(assessed_at.eq.${boundedPage.after.at},id.lt.${boundedPage.after.id})`,
    )
  }

  // One-version compatibility window: callers deployed before PR-09 omit
  // `limit` and still receive the complete oldest-to-newest history. Every
  // current caller opts into the bounded contract. Remove this branch after
  // one deployed app version, following docs/qa/pr09-performance-runbook.md.
  query = boundedPage
    ? query
        .order('assessed_at', { ascending: false })
        .order('id', { ascending: false })
        .lte('assessed_at', boundedPage.snapshotAt)
        .limit(boundedPage.limit + 1)
    : query
        .order('assessed_at', { ascending: true })
        .order('id', { ascending: true })

  const { data: assessments, error } = await query
  if (error) {
    // A DB/RLS/network failure must not be masked as "no assessments" — that would
    // render the empty state (and drop the comparison picker's options) for a client
    // with real history. Surface it so the consumer's `if (!res.ok)` path fires.
    logEvent({
      route: 'GET /api/clients/[id]/assessments',
      outcome: 'server_error',
      status: 500,
      userHash: hashUser(user.id),
      resourceHash: hashResource(clientId),
      detailCode: 'assessment_history_load_failed',
    })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500, headers: NO_STORE })
  }

  if (!boundedPage) {
    return NextResponse.json({ assessments: assessments ?? [] }, { headers: NO_STORE })
  }

  const result = finalizeKeysetPage((assessments ?? []) as unknown as Array<{ id: string; assessed_at: string }>, {
    scope: CLIENT_ASSESSMENT_LIST_SCOPE,
    filterKey,
    snapshotAt: boundedPage.snapshotAt,
    limit: boundedPage.limit,
    key: (assessment) => ({ at: canonicalizeKeysetTimestamp(assessment.assessed_at), id: assessment.id }),
  })
  // Preserve the prior endpoint's oldest-to-newest response ordering for one
  // deployed client version. The keyset cursor still advances over the bounded
  // newest-first database page; current consumers normalize all loaded pages.
  const compatibilityOrderedRecords = [...result.records].reverse()
  return NextResponse.json(
    { assessments: compatibilityOrderedRecords, pagination: result.pagination },
    { headers: NO_STORE },
  )
}
