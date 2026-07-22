import { describe, test, expect } from 'vitest'
import { redactSessionForPublic, type ResolvedSession } from './tokenProjection'
import type { SessionSnapshot } from './generateWorkoutSession'
import type { LegalSnapshot } from '../legal/types'

const snapshot = { version: 1, week: 1, capability: 'standard', priorities: [], items: [], estimatedDurationSec: 720, disclaimer: 'Screening only.' } as SessionSnapshot
const clinicalRelease = { version: 'clinical-content-test-fixture-v1', inventorySha256: 'd'.repeat(64) }

const resolved: ResolvedSession = {
  workout_session_id: 'ws-secret',
  practitioner_id: 'prac-secret',
  client_id: 'client-secret',
  session_run_id: 'run-secret',
  program_snapshot: snapshot,
  estimated_duration_sec: 720,
  client_first_name: 'Sam',
  expires_at: '2026-07-09T00:00:00.000Z',
  legal_document_id: null,
  legal_document_version: null,
  legal_document_body_sha256: null,
  legal_document_effective_at: null,
  legal_jurisdiction: null,
  legal_product_scope: null,
  legal_provenance_state: 'legacy_unverified',
  clinical_content_version: null,
  clinical_inventory_sha256: null,
}

const legalNotice: LegalSnapshot = {
  schemaVersion: 1,
  documentId: 'screening-notice-v1',
  kind: 'screening_notice',
  version: '2026-07-20',
  title: 'Screening Notice',
  effectiveAt: '2026-07-20T00:00:00.000Z',
  jurisdiction: 'US',
  locale: 'en-US',
  productScope: 'us_fitness_wellness_assessment_beta_v1',
  audience: 'public',
  bodySha256: 'ad48aaa235c910cc56721c4e5c0ccc17d476e8207df0f73db8129a6cabb85ce7',
  text: 'Screening Notice\n\nExact governed workout notice.',
  sections: [{ id: 'notice', heading: null, paragraphs: ['Exact governed workout notice.'] }],
  isFixture: true,
}

describe('redactSessionForPublic', () => {
  test('rejects a legacy snapshot without clinical release provenance', () => {
    expect(redactSessionForPublic(resolved, clinicalRelease)).toBeNull()
  })

  test('never leaks internal identifiers (session/practitioner/client/run ids)', () => {
    const governed = {
      version: 3,
      week: 1,
      capability: 'standard',
      priorities: [],
      items: [],
      estimatedDurationSec: 720,
      legalNotice,
      clinicalContent: clinicalRelease,
    } as SessionSnapshot
    const pub = redactSessionForPublic({
      ...resolved,
      program_snapshot: governed,
      legal_document_id: legalNotice.documentId,
      legal_document_version: legalNotice.version,
      legal_document_body_sha256: legalNotice.bodySha256,
      legal_document_effective_at: legalNotice.effectiveAt,
      legal_jurisdiction: legalNotice.jurisdiction,
      legal_product_scope: legalNotice.productScope,
      legal_provenance_state: 'governed',
      clinical_content_version: clinicalRelease.version,
      clinical_inventory_sha256: clinicalRelease.inventorySha256,
    }, clinicalRelease) as unknown as Record<string, unknown>
    expect(pub).not.toBeNull()
    const leaked = ['ws-secret', 'prac-secret', 'client-secret', 'run-secret']
    const serialized = JSON.stringify(pub)
    for (const id of leaked) expect(serialized).not.toContain(id)
    for (const k of ['workout_session_id', 'practitioner_id', 'client_id', 'session_run_id']) {
      expect(k in pub).toBe(false)
    }
  })

  test('drops unknown v3 snapshot fields — jsonb drift cannot silently widen the public surface', () => {
    // program_snapshot is a jsonb blob written at mint time. If the snapshot
    // shape ever grows a field (refactor, migration, spread), it must NOT reach
    // the public path unless someone adds it to the projection on purpose.
    const drifted = {
      version: 3,
      week: 1,
      capability: 'standard',
      priorities: [],
      items: [],
      estimatedDurationSec: 720,
      legalNotice,
      clinicalContent: clinicalRelease,
      assessmentId: 'assess-secret',
      internalNotes: 'client has a history of…',
    } as unknown as SessionSnapshot
    const pub = redactSessionForPublic({
      ...resolved,
      program_snapshot: drifted,
      legal_document_id: legalNotice.documentId,
      legal_document_version: legalNotice.version,
      legal_document_body_sha256: legalNotice.bodySha256,
      legal_document_effective_at: legalNotice.effectiveAt,
      legal_jurisdiction: legalNotice.jurisdiction,
      legal_product_scope: legalNotice.productScope,
      legal_provenance_state: 'governed',
      clinical_content_version: clinicalRelease.version,
      clinical_inventory_sha256: clinicalRelease.inventorySha256,
    }, clinicalRelease)
    expect(pub).not.toBeNull()
    const serialized = JSON.stringify(pub)
    expect(serialized).not.toContain('assess-secret')
    expect(serialized).not.toContain('internalNotes')
    expect(Object.keys(pub!.snapshot).sort()).toEqual(
      ['capability', 'clinicalContent', 'estimatedDurationSec', 'items', 'legalNotice', 'priorities', 'version', 'week'].sort(),
    )
  })

  test('rejects a governed v2 snapshot because it has no clinical provenance', () => {
    const governed = {
      version: 2,
      week: 1,
      capability: 'standard',
      priorities: [],
      items: [],
      estimatedDurationSec: 720,
      legalNotice,
      internalNotes: 'must remain private',
    } as unknown as SessionSnapshot

    const pub = redactSessionForPublic({
      ...resolved,
      program_snapshot: governed,
      legal_document_id: legalNotice.documentId,
      legal_document_version: legalNotice.version,
      legal_document_body_sha256: legalNotice.bodySha256,
      legal_document_effective_at: '2026-07-20T00:00:00+00:00',
      legal_jurisdiction: legalNotice.jurisdiction,
      legal_product_scope: legalNotice.productScope,
      legal_provenance_state: 'governed',
      clinical_content_version: null,
      clinical_inventory_sha256: null,
    }, clinicalRelease)

    expect(pub).toBeNull()
  })

  test.each([
    ['row id', { legal_document_id: 'different-id' }],
    ['row hash', { legal_document_body_sha256: '0'.repeat(64) }],
    ['row effective instant', { legal_document_effective_at: '2026-07-21T00:00:00+00:00' }],
    ['embedded content', {
      program_snapshot: {
        version: 3,
        week: 1,
        capability: 'standard',
        priorities: [],
        items: [],
        estimatedDurationSec: 720,
        legalNotice: { ...legalNotice, text: 'Tampered notice text.' },
        clinicalContent: clinicalRelease,
      },
    }],
  ])('rejects governed snapshots whose %s is not bound to provenance', (_label, mutation) => {
    const governed = {
      version: 3,
      week: 1,
      capability: 'standard',
      priorities: [],
      items: [],
      estimatedDurationSec: 720,
      legalNotice,
      clinicalContent: clinicalRelease,
    } as SessionSnapshot
    const row = {
      ...resolved,
      program_snapshot: governed,
      legal_document_id: legalNotice.documentId,
      legal_document_version: legalNotice.version,
      legal_document_body_sha256: legalNotice.bodySha256,
      legal_document_effective_at: legalNotice.effectiveAt,
      legal_jurisdiction: legalNotice.jurisdiction,
      legal_product_scope: legalNotice.productScope,
      legal_provenance_state: 'governed',
      clinical_content_version: clinicalRelease.version,
      clinical_inventory_sha256: clinicalRelease.inventorySha256,
      ...mutation,
    } as ResolvedSession

    expect(redactSessionForPublic(row, clinicalRelease)).toBeNull()
  })

  test('rejects a governed v2 snapshot presented as legacy provenance', () => {
    const governed = {
      version: 2,
      week: 1,
      capability: 'standard',
      priorities: [],
      items: [],
      estimatedDurationSec: 720,
      legalNotice,
    } as SessionSnapshot
    expect(redactSessionForPublic({ ...resolved, program_snapshot: governed }, clinicalRelease)).toBeNull()
  })

  test('rejects a legacy snapshot paired with governed provenance', () => {
    expect(redactSessionForPublic({
      ...resolved,
      legal_document_id: legalNotice.documentId,
      legal_document_version: legalNotice.version,
      legal_document_body_sha256: legalNotice.bodySha256,
      legal_document_effective_at: legalNotice.effectiveAt,
      legal_jurisdiction: legalNotice.jurisdiction,
      legal_product_scope: legalNotice.productScope,
      legal_provenance_state: 'governed',
    }, clinicalRelease)).toBeNull()
  })
})
