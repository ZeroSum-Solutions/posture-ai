import inventory from '@/content/clinical-content-inventory.json'
import ledger from '@/content/clinical-review-ledger.json'
import { resolveClinicalContentAccess, type ClinicalContentAccess } from './policy'

/**
 * Server-only runtime resolver. Public NEXT_PUBLIC_* state is never sufficient:
 * the complete fixture catalog also requires POSTURE_TEST_MODE_ENABLED, while a
 * production release requires an exact source-controlled release id + HG-03
 * receipt hash pair.
 */
export function clinicalContentAccess(): ClinicalContentAccess {
  const testFixtureEnabled = process.env.VERCEL_ENV !== 'production'
    && process.env.POSTURE_TEST_MODE_ENABLED === '1'
    && process.env.NEXT_PUBLIC_SHOW_UNREVIEWED_CONTENT === '1'
  return resolveClinicalContentAccess({
    inventory,
    ledger,
    releaseId: process.env.CLINICAL_CONTENT_RELEASE_ID,
    hg03ReceiptSha256: process.env.CLINICAL_CONTENT_HG03_RECEIPT_SHA256,
    testFixtureEnabled,
  })
}
