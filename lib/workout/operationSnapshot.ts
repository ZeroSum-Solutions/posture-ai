import { DISCLAIMER } from '../../packages/posture-engine/src/engine'
import type { PractitionerOperation } from '@/lib/prototype/runtime'
import type {
  ClinicalGovernedSessionSnapshot,
  PrototypeSessionSnapshot,
  SessionSnapshot,
} from './generateWorkoutSession'
import { isClinicalSnapshotForRelease } from './tokenProjection'

export type WorkoutCatalogIdentity = {
  version: string
  inventorySha256: string
}

/** Freeze playable content with explicit, unreviewed prototype provenance. */
export function mintPrototypeSessionSnapshot(
  snapshot: SessionSnapshot,
  clinicalContent: WorkoutCatalogIdentity,
): PrototypeSessionSnapshot {
  return {
    version: 4,
    operationMode: 'prototype',
    contentState: 'prototype_unreviewed',
    week: snapshot.week,
    capability: snapshot.capability,
    priorities: snapshot.priorities,
    items: snapshot.items,
    estimatedDurationSec: snapshot.estimatedDurationSec,
    disclaimer: DISCLAIMER,
    clinicalContent,
  }
}

export function isPrototypeSnapshotForCatalog(
  value: unknown,
  catalog: WorkoutCatalogIdentity,
): value is PrototypeSessionSnapshot {
  if (!value || typeof value !== 'object') return false
  const snapshot = value as Record<string, unknown>
  if (
    snapshot.version !== 4
    || snapshot.operationMode !== 'prototype'
    || snapshot.contentState !== 'prototype_unreviewed'
    || 'legalNotice' in snapshot
    || !snapshot.clinicalContent
    || typeof snapshot.clinicalContent !== 'object'
  ) return false
  const content = snapshot.clinicalContent as Record<string, unknown>
  return content.version === catalog.version
    && content.inventorySha256 === catalog.inventorySha256
}

export function isSessionSnapshotForOperation(
  value: unknown,
  operation: PractitionerOperation,
  catalog: WorkoutCatalogIdentity,
): value is PrototypeSessionSnapshot | ClinicalGovernedSessionSnapshot {
  return operation.isPrototype && operation.mode === 'prototype'
    ? isPrototypeSnapshotForCatalog(value, catalog)
    : isClinicalSnapshotForRelease(value, catalog)
}
