import ConsentResponder from '@/components/ConsentResponder'
import {
  isConsentTokenUsable,
  resolvePinnedConsentDocument,
} from '@/lib/consent/policy'
import { hashConsentToken } from '@/lib/consent/token'
import type { LegalSnapshot } from '@/lib/legal/types'
import { createSupabaseServiceClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

// Public page (allow-listed in proxy.ts). The remote subject opens this via the
// link/QR the practitioner shared, reads the consent terms, and signs.
export default async function ConsentPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  let document: LegalSnapshot | null = null

  if (token.length >= 20) {
    const service = createSupabaseServiceClient()
    const { data, error } = await service
      .from('consent_tokens')
      .select('created_at, expires_at, consumed_at, legal_document_id, legal_document_version, legal_document_body_sha256, legal_document_effective_at, legal_jurisdiction, legal_product_scope, legal_provenance_state')
      .eq('token_hash', hashConsentToken(token))
      .maybeSingle()

    if (!error && data && isConsentTokenUsable(data)) {
      const resolution = resolvePinnedConsentDocument(data, data.created_at)
      if (resolution.ok) document = resolution.document
    }
  }

  return <ConsentResponder token={token} document={document} />
}
