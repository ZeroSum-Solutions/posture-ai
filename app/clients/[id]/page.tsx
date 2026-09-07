import { redirect } from 'next/navigation'
import { practitionerGate } from '@/lib/auth/requirePractitioner'
import {
  CLIENT_ASSESSMENT_LIST_SCOPE,
  clientAssessmentHistoryFilterKey,
} from '@/lib/clients/assessment-history'
import { hashResource, hashUser, logEvent } from '@/lib/log'
import { canonicalizeKeysetTimestamp, finalizeKeysetPage } from '@/lib/pagination/keyset'
import { getConsentStatus } from '@/lib/consent/record'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import ClientDetailClient, { type ClientDetailInitialData } from './ClientDetailClient'
import { operationForPractitioner } from '@/lib/prototype/runtime'

export const dynamic = 'force-dynamic'

const INITIAL_HISTORY_PAGE_SIZE = 20

async function loadInitialClientDetail(id: string): Promise<ClientDetailInitialData | null> {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/sign-in')

  // Preserve the API route's full practitioner, MFA, legal, and BAA gate before
  // rendering any owned health record into the navigation response.
  const gate = await practitionerGate(supabase, user.id)
  if (gate) return null
  const operation = operationForPractitioner(user.id)

  const { data: preciseSnapshot, error: snapshotError } = await supabase.rpc('current_keyset_snapshot')
  let snapshotAt: string
  try {
    if (snapshotError || typeof preciseSnapshot !== 'string') throw new Error('snapshot unavailable')
    snapshotAt = canonicalizeKeysetTimestamp(preciseSnapshot)
  } catch {
    logEvent({
      route: 'GET /clients/[id]',
      outcome: 'server_error',
      status: 500,
      userHash: hashUser(user.id),
      resourceHash: hashResource(id),
      detailCode: snapshotError ? 'client_detail_seed_snapshot_failed' : 'client_detail_seed_snapshot_invalid',
    })
    return null
  }
  const [clientResult, historyResult, consent] = await Promise.all([
    supabase
      .from('clients')
      .select('id, first_name, last_name, date_of_birth, sex_at_birth, height_cm, weight_kg, notes, consent_recorded_at, created_at')
      .eq('id', id)
      .eq('practitioner_id', user.id)
      .is('archived_at', null)
      .is('deleted_at', null)
      .maybeSingle(),
    supabase
      .from('assessments')
      .select('id, assessed_at, overall_grade, overall_score, status, scoring_engine_version, assessment_findings(imbalance_key, label, severity_pct, zone, region, deviation, standard, unit)')
      .eq('client_id', id)
      .eq('practitioner_id', user.id)
      .eq('status', 'complete')
      .lte('assessed_at', snapshotAt)
      .order('assessed_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(INITIAL_HISTORY_PAGE_SIZE + 1),
    operation.isPrototype ? Promise.resolve(null) : getConsentStatus(supabase, id),
  ])

  if (clientResult.error || historyResult.error) {
    logEvent({
      route: 'GET /clients/[id]',
      outcome: 'server_error',
      status: 500,
      userHash: hashUser(user.id),
      resourceHash: hashResource(id),
      detailCode: clientResult.error
        ? 'client_detail_seed_identity_failed'
        : 'client_detail_seed_history_failed',
    })
    return null
  }
  if (!clientResult.data) redirect('/clients')

  const filterKey = clientAssessmentHistoryFilterKey({
    clientId: id,
    includeFindings: true,
    approvedOnly: false,
  })
  const page = finalizeKeysetPage(
    (historyResult.data ?? []) as unknown as ClientDetailInitialData['assessments'],
    {
      scope: CLIENT_ASSESSMENT_LIST_SCOPE,
      filterKey,
      snapshotAt,
      limit: INITIAL_HISTORY_PAGE_SIZE,
      key: (assessment) => ({
        at: canonicalizeKeysetTimestamp(assessment.assessed_at),
        id: assessment.id,
      }),
    },
  )

  return {
    operationMode: operation.mode,
    client: clientResult.data as unknown as ClientDetailInitialData['client'],
    // The client workspace owns one chronological representation even though
    // the bounded database page and cursor advance newest-first.
    assessments: [...page.records].reverse(),
    consentStatus: operation.isPrototype
      ? 'not_required'
      : consent?.hasConsent && consent.legalState === 'current'
      ? 'valid'
      : consent?.legalState === 'withdrawn'
        ? 'withdrawn'
        : consent?.legalState === 'reconsent_required'
          ? 'reconsent_required'
          : consent?.legalState === 'missing'
            ? 'missing'
            : 'unavailable',
    pagination: page.pagination,
  }
}

export default async function ClientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const initialData = await loadInitialClientDetail(id)
  return <ClientDetailClient initialData={initialData} />
}
