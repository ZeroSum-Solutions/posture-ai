import type { SupabaseClient } from '@supabase/supabase-js'
import { disabledClinicalContent, type ClinicalContentAccess } from './policy'
import { operationForPractitioner } from '@/lib/prototype/runtime'
import { clinicalContentAccess, clinicalContentAccessForOperation } from './runtime'

/**
 * Cross-check the source-controlled HG-03 release against the independent DB
 * activation pointer. The RPC returns only a boolean for the exact tuple; it
 * does not expose which release (if any) is active.
 */
export async function verifyClinicalContentAccess(
  access: ClinicalContentAccess,
  client: Pick<SupabaseClient, 'rpc'>,
): Promise<ClinicalContentAccess> {
  if (access.mode !== 'approved' || !access.contentVersion) return access
  try {
    const { data, error } = await client.rpc('verify_clinical_content_activation', {
      p_release_id: access.contentVersion,
      p_inventory_sha256: access.inventorySha256,
      p_receipt_sha256: process.env.CLINICAL_CONTENT_HG03_RECEIPT_SHA256 ?? '',
      p_recommendations_enabled: access.surfaces.recommendations,
      p_programs_enabled: access.surfaces.programs,
      p_workouts_enabled: access.surfaces.workouts,
      p_knowledge_links_enabled: access.surfaces.knowledgeLinks,
    })
    if (!error && data === true) return access
  } catch {
    // Transport failures are indistinguishable from a missing activation. The
    // only safe result is the same assessment-only projection as a mismatch.
  }
  return disabledClinicalContent(access.inventorySha256, 'database_activation_mismatch')
}

export async function serverClinicalContentAccess(): Promise<ClinicalContentAccess> {
  const access = clinicalContentAccess()
  if (access.mode !== 'approved') return access
  const { createSupabaseServiceClient } = await import('@/lib/supabase/server')
  return verifyClinicalContentAccess(access, createSupabaseServiceClient())
}

/**
 * Resolve content for one already-admitted practitioner. Prototype catalog
 * access is explicit provenance, so it must not be represented as a clinical
 * release or passed through the HG-03 activation verifier.
 */
export async function serverClinicalContentAccessForPractitioner(
  practitionerId: string,
): Promise<ClinicalContentAccess> {
  const access = clinicalContentAccessForOperation(operationForPractitioner(practitionerId))
  if (access.mode !== 'approved') return access
  const { createSupabaseServiceClient } = await import('@/lib/supabase/server')
  return verifyClinicalContentAccess(access, createSupabaseServiceClient())
}
