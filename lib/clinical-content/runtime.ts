import inventory from '@/content/clinical-content-inventory.json'
import ledger from '@/content/clinical-review-ledger.json'
import type { PractitionerOperation } from '@/lib/prototype/runtime'
import { resolveClinicalContentAccess, type ClinicalContentAccess } from './policy'

/**
 * Server-only runtime resolver. The clinical-content review gate (HG-03 release
 * + receipt) was removed by the product owner on 2026-10-01: every practitioner
 * gets the full catalog, recorded as an "open" content version whose database
 * receipt states that no clinical review took place.
 */
export function clinicalContentAccess(): ClinicalContentAccess {
  return resolveClinicalContentAccess({ inventory, ledger, openAccess: true })
}

/** Resolve the catalog for an already-admitted practitioner's operation. */
export function clinicalContentAccessForOperation(
  operation: PractitionerOperation,
): ClinicalContentAccess {
  if (!operation.isPrototype || operation.mode !== 'prototype') return clinicalContentAccess()
  return resolveClinicalContentAccess({
    inventory,
    ledger,
    prototypeEnabled: true,
  })
}
