import { describe, expect, test } from 'vitest'
import inventoryJson from '@/content/clinical-content-inventory.json'
import { buildClinicalContentInventory } from './inventory'
import { resolveClinicalContentAccess } from './policy'

const RECEIPT = 'a'.repeat(64)

function item(id: string) {
  const found = inventoryJson.items.find((entry) => entry.id === id)
  if (!found) throw new Error(`Missing fixture inventory item ${id}`)
  return {
    id: found.id,
    status: 'approved' as const,
    item_sha256: found.sha256,
    reviewed_at: '2026-07-20T00:00:00.000Z',
    reviewer_note: 'Item reviewed within its screening-only scope.',
  }
}

function ledger(ids: string[], surfaces: Partial<Record<'recommendations' | 'programs' | 'workouts' | 'knowledgeLinks', boolean>> = {}) {
  return {
    schema_version: 1 as const,
    releases: [{
      id: 'clinician-approved-v1',
      status: 'approved' as const,
      inventory_sha256: inventoryJson.inventory_sha256,
      hg03_receipt_sha256: RECEIPT,
      approved_at: '2026-07-20T00:00:00.000Z',
      reviewer: {
        name: 'Licensed Reviewer',
        license_jurisdiction: 'CA',
        license_identifier: 'fixture-license',
        attestation: 'licensed_clinician' as const,
      },
      surfaces: {
        recommendations: false,
        programs: false,
        workouts: false,
        knowledgeLinks: false,
        ...surfaces,
      },
      items: ids.map(item),
    }],
  }
}

function resolve(reviewLedger: unknown, overrides: Record<string, unknown> = {}) {
  return resolveClinicalContentAccess({
    inventory: inventoryJson,
    ledger: reviewLedger,
    releaseId: 'clinician-approved-v1',
    hg03ReceiptSha256: RECEIPT,
    ...overrides,
  })
}

describe('clinical content inventory', () => {
  test('reconciles every authored clinical item and its hash', () => {
    expect(buildClinicalContentInventory()).toEqual(inventoryJson)
    expect(inventoryJson.counts).toEqual({
      muscles: 29,
      exercises: 73,
      links: 46,
      exercise_muscles: 119,
      contraindications: 1,
      report_copy: 12,
      algorithms: 1,
    })
    expect(new Set(inventoryJson.items.map((entry) => entry.id)).size).toBe(inventoryJson.items.length)
  })
})

describe('resolveClinicalContentAccess', () => {
  test('defaults to assessment-only when HG-03 activation is absent', () => {
    const result = resolveClinicalContentAccess({ inventory: inventoryJson, ledger: { schema_version: 1, releases: [] } })
    expect(result.mode).toBe('disabled')
    expect(Object.values(result.surfaces).every((enabled) => enabled === false)).toBe(true)
    expect(result.reason).toBe('hg03_activation_absent')
  })

  test('a public unreviewed-content flag cannot activate the fixture by itself', () => {
    const result = resolveClinicalContentAccess({
      inventory: inventoryJson,
      ledger: { schema_version: 1, releases: [] },
      testFixtureEnabled: false,
    })
    expect(result.mode).toBe('disabled')
  })

  test('the explicit server-side test fixture is complete and visibly non-production', () => {
    const result = resolveClinicalContentAccess({
      inventory: inventoryJson,
      ledger: { schema_version: 1, releases: [] },
      testFixtureEnabled: true,
    })
    expect(result.mode).toBe('test_fixture')
    expect(result.approvedMuscleSlugs).toHaveLength(29)
    expect(result.approvedExerciseSlugs).toHaveLength(73)
    expect(result.approvedExerciseMuscleIds).toHaveLength(119)
    expect(result.approvedAlgorithmIds).toEqual(['algorithm:recommendation-engine'])
    expect(Object.values(result.surfaces).every(Boolean)).toBe(true)
  })

  test('an exact approved subset enables only its reviewed items', () => {
    const muscle = 'muscle:hamstrings'
    const link = 'link:hamstrings:knee_extension_back_knee:weak'
    const exercise = 'exercise:prone-hamstring-curl'
    const result = resolve(ledger(
      [
        muscle,
        link,
        exercise,
        'exercise_muscle:prone-hamstring-curl:hamstrings:strengthen:1',
        'report_copy:knee_extension_back_knee',
        'algorithm:recommendation-engine',
      ],
      { recommendations: true, programs: true, workouts: true, knowledgeLinks: true },
    ))

    expect(result.mode).toBe('approved')
    expect(result.approvedMuscleSlugs).toEqual(['hamstrings'])
    expect(result.approvedExerciseSlugs).toEqual(['prone-hamstring-curl'])
    expect(result.approvedLinkIds).toEqual([link])
    expect(result.approvedExerciseMuscleIds).toEqual([
      'exercise_muscle:prone-hamstring-curl:hamstrings:strengthen:1',
    ])
    expect(result.approvedReportCopyIds).toEqual(['report_copy:knee_extension_back_knee'])
    expect(result.approvedAlgorithmIds).toEqual(['algorithm:recommendation-engine'])
    expect(result.surfaces).toEqual({
      recommendations: true,
      programs: true,
      workouts: true,
      knowledgeLinks: true,
    })
  })

  test('reviewing an exercise without its authored contraindication cannot approve that exercise', () => {
    const result = resolve(ledger(
      ['exercise:seated-hamstring-stretch'],
      { recommendations: true },
    ))
    expect(result.mode).toBe('disabled')
    expect(result.reason).toBe('release_approves_no_surface')
  })

  test('reviewing an exercise relationship without its parent muscle cannot approve recommendations', () => {
    const result = resolve(ledger(
      [
        'exercise:prone-hamstring-curl',
        'exercise_muscle:prone-hamstring-curl:hamstrings:strengthen:1',
        'algorithm:recommendation-engine',
      ],
      { recommendations: true },
    ))

    expect(result.mode).toBe('disabled')
    expect(result.reason).toBe('release_approves_no_surface')
  })

  test('an exercise alone cannot activate the reviewed recommendation algorithm', () => {
    const result = resolve(ledger(
      ['exercise:prone-hamstring-curl'],
      { recommendations: true },
    ))

    expect(result.mode).toBe('disabled')
  })

  test.each([
    ['wrong receipt', { hg03ReceiptSha256: 'b'.repeat(64) }],
    ['wrong release', { releaseId: 'missing-release' }],
  ])('fails closed for %s', (_label, overrides) => {
    const result = resolve(ledger(['exercise:prone-hamstring-curl'], { recommendations: true }), overrides)
    expect(result.mode).toBe('disabled')
  })

  test('fails closed when an item changed after review', () => {
    const reviewLedger = ledger(['exercise:prone-hamstring-curl'], { recommendations: true })
    reviewLedger.releases[0].items[0].item_sha256 = 'b'.repeat(64)
    const result = resolve(reviewLedger)
    expect(result.mode).toBe('disabled')
    expect(result.reason).toBe('review_item_hash_mismatch')
  })

  test('fails closed on duplicate review records instead of generalizing partial review', () => {
    const reviewLedger = ledger(['exercise:prone-hamstring-curl'], { recommendations: true })
    reviewLedger.releases[0].items.push({ ...reviewLedger.releases[0].items[0] })
    const result = resolve(reviewLedger)
    expect(result.mode).toBe('disabled')
    expect(result.reason).toBe('duplicate_review_item')
  })
})
