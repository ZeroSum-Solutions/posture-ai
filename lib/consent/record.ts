import type { SupabaseClient } from '@supabase/supabase-js'
import { ageBand, canCapture, captureBlockReason, isGuardianRelationship } from '@/lib/clients/age'

export type ConsentStatus = {
  hasConsent: boolean
  signerRelationship: string | null
}

/**
 * The latest non-revoked subject-consent record for a client. Accepts either an
 * RLS-scoped client (practitioner reads own) or the service client (server gate).
 */
export async function getConsentStatus(db: SupabaseClient, clientId: string): Promise<ConsentStatus> {
  const { data } = await db
    .from('consent_records')
    .select('signer_relationship, recorded_at')
    .eq('client_id', clientId)
    .is('revoked_at', null)
    .order('recorded_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!data) return { hasConsent: false, signerRelationship: null }
  return { hasConsent: true, signerRelationship: data.signer_relationship as string }
}

/**
 * Whether a subject may be captured: requires (a) a valid subject consent and
 * (b) the age gate to pass (under-13 blocked; 13–17 needs a guardian-signed
 * consent; unknown DOB blocked). Returns a human-readable reason when blocked.
 */
export function captureEligibility(
  dob: string | null | undefined,
  consent: ConsentStatus,
  now: Date = new Date(),
): { ok: boolean; reason: string | null } {
  if (!consent.hasConsent) {
    return { ok: false, reason: 'Subject consent is required before screening can begin.' }
  }
  const band = ageBand(dob, now)
  const hasGuardianConsent = isGuardianRelationship(consent.signerRelationship)
  if (!canCapture(band, hasGuardianConsent)) {
    return { ok: false, reason: captureBlockReason(band, hasGuardianConsent) }
  }
  return { ok: true, reason: null }
}
