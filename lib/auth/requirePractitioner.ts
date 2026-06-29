import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Practitioner access gate for API routes. Reuses the caller's already-authed
 * Supabase client + user id (no extra session round-trip) and enforces:
 *  1. the user is a practitioner (a row in `practitioners`) — 403 otherwise,
 *  2. the HIPAA org BAA gate: if the practitioner belongs to a covered-entity
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
  const { data: prac } = await supabase
    .from('practitioners')
    .select('id, organization_id')
    .eq('id', userId)
    .maybeSingle()

  if (!prac) {
    return NextResponse.json({ error: 'Practitioner access required.' }, { status: 403 })
  }

  if (prac.organization_id) {
    const { data: org } = await supabase
      .from('organizations')
      .select('is_covered_entity, baa_status')
      .eq('id', prac.organization_id)
      .maybeSingle()
    if (org && org.is_covered_entity === true && org.baa_status !== 'signed') {
      return NextResponse.json(
        { error: 'A signed Business Associate Agreement is required before practitioner mode can be used for this organization.' },
        { status: 403 },
      )
    }
  }

  return null
}
