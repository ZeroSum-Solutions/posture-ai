import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createSupabaseServiceClient } from '@/lib/supabase/server'

export type AdmittedPractitioner = {
  id: string
  organization_id: string | null
  practice_name: string | null
  display_name: string | null
  access_status: string
  role: string
}

export type PractitionerAdmission =
  | { practitioner: AdmittedPractitioner; response: null }
  | { practitioner: null; response: NextResponse }

function forbidden(code: 'mfa_required' | 'practitioner_access_required' | 'compliance', error: string) {
  return NextResponse.json({ error, code }, { status: 403 })
}

/**
 * Admission shared by the normal practitioner gate and the organization-settings
 * exception. Authentication (401) remains the caller's responsibility; this
 * function authorizes only sessions that have reached AAL2 and whose practitioner
 * account is explicitly active.
 */
export async function practitionerAdmission(
  supabase: SupabaseClient,
  userId: string,
): Promise<PractitionerAdmission> {
  try {
    const { data: assurance, error: assuranceError } =
      await supabase.auth.mfa.getAuthenticatorAssuranceLevel()

    if (assuranceError || assurance?.currentLevel !== 'aal2') {
      return {
        practitioner: null,
        response: forbidden('mfa_required', 'Multi-factor authentication is required.'),
      }
    }
  } catch {
    return {
      practitioner: null,
      response: forbidden('mfa_required', 'Multi-factor authentication is required.'),
    }
  }

  try {
    const { data, error } = await supabase
      .from('practitioners')
      .select('id, organization_id, practice_name, display_name, access_status, role')
      .eq('id', userId)
      .maybeSingle()
    const practitioner = data as AdmittedPractitioner | null

    if (
      error ||
      !practitioner ||
      practitioner.access_status !== 'active' ||
      practitioner.role !== 'practitioner'
    ) {
      return {
        practitioner: null,
        response: forbidden(
          'practitioner_access_required',
          'Active practitioner access is required.',
        ),
      }
    }

    return { practitioner, response: null }
  } catch {
    return {
      practitioner: null,
      response: forbidden(
        'practitioner_access_required',
        'Active practitioner access is required.',
      ),
    }
  }
}

/**
 * Practitioner access gate for API routes. Reuses the caller's already-authed
 * Supabase client + user id (no extra session round-trip) and enforces:
 *  1. the session has reached AAL2 — 403 otherwise,
 *  2. the user is an active practitioner — 403 otherwise,
 *  3. the HIPAA org BAA gate: if the practitioner belongs to a covered-entity
 *     organization whose BAA is not signed, access is blocked (403).
 *
 * Returns a NextResponse to short-circuit with, or null when access is allowed.
 * Combined with the 401 the routes already do for unauthenticated requests and
 * with RLS, this honors the FDA consumer NO-GO: only an authenticated
 * practitioner may reach capture, results, or exercise output.
 *
 * Usage (additive, right after the existing `if (!user)` check):
 *   const gate = await practitionerGate(supabase, user.id)
 *   if (gate) return gate
 */
export async function practitionerGate(
  supabase: SupabaseClient,
  userId: string,
): Promise<NextResponse | null> {
  const admission = await practitionerAdmission(supabase, userId)
  if (admission.response) return admission.response
  const prac = admission.practitioner

  if (prac.organization_id) {
    // Read the org with service-role: the BAA gate must not depend on the
    // (now own-org-scoped) organizations RLS policy, and this is the caller's own
    // org id (no IDOR).
    const service = createSupabaseServiceClient()
    const { data: org, error } = await service
      .from('organizations')
      .select('is_covered_entity, baa_status')
      .eq('id', prac.organization_id)
      .maybeSingle()

    // FAIL CLOSED: an org-linked practitioner whose org cannot be read (query
    // error, or a dangling organization_id) is denied. A HIPAA BAA gate must
    // never be skipped just because the compliance check itself failed.
    if (error || !org) {
      return forbidden(
        'compliance',
        'Could not verify your organization’s compliance status. Please try again.',
      )
    }

    if (org.is_covered_entity === true && org.baa_status !== 'signed') {
      return forbidden(
        'compliance',
        'A signed Business Associate Agreement is required before practitioner mode can be used for this organization.',
      )
    }
  }

  return null
}
