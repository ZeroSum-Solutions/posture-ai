import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { User } from '@supabase/supabase-js'
import { createSupabaseServerClient } from '@/lib/supabase/server'

type Ok = { ok: true; user: User; supabase: SupabaseClient }
type Err = { ok: false; response: NextResponse }

/**
 * Server-side practitioner gate for API routes. Enforces, in order:
 *  1. an authenticated session (401 otherwise),
 *  2. that the user is a practitioner (a row in `practitioners`) — 403 otherwise,
 *  3. the HIPAA org BAA gate: if the practitioner belongs to a covered-entity
 *     organization whose BAA is not signed, capture/data access is blocked (403).
 *
 * This is the single choke-point that honors the FDA consumer NO-GO (no
 * non-practitioner role may capture, analyze, or read results).
 *
 * Usage:
 *   const auth = await requirePractitioner()
 *   if (!auth.ok) return auth.response
 *   const { user, supabase } = auth
 */
export async function requirePractitioner(): Promise<Ok | Err> {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { ok: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }

  const { data: prac } = await supabase
    .from('practitioners')
    .select('id, organization_id, organizations(is_covered_entity, baa_status)')
    .eq('id', user.id)
    .maybeSingle()

  if (!prac) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Practitioner access required.' }, { status: 403 }),
    }
  }

  // organizations(...) comes back as an object (to-one) or null.
  const org = (prac as { organizations?: { is_covered_entity?: boolean; baa_status?: string } | null }).organizations
  if (org && org.is_covered_entity === true && org.baa_status !== 'signed') {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'A signed Business Associate Agreement is required before practitioner mode can be used for this organization.' },
        { status: 403 },
      ),
    }
  }

  return { ok: true, user, supabase }
}
