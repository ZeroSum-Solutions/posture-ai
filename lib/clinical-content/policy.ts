import { z } from 'zod'

export const CLINICAL_SURFACE_NAMES = [
  'recommendations',
  'programs',
  'workouts',
  'knowledgeLinks',
] as const

export type ClinicalSurfaceName = (typeof CLINICAL_SURFACE_NAMES)[number]
export type ClinicalSurfaceAccess = Record<ClinicalSurfaceName, boolean>
export type ClinicalItemKind =
  | 'muscle'
  | 'exercise'
  | 'link'
  | 'exercise_muscle'
  | 'contraindication'
  | 'report_copy'
  | 'algorithm'

const SHA256 = /^[a-f0-9]{64}$/
const ITEM_ID = /^(muscle|exercise|link|exercise_muscle|contraindication|report_copy|algorithm):[a-z0-9_.:-]+$/

const itemSchema = z.object({
  id: z.string().regex(ITEM_ID),
  kind: z.enum(['muscle', 'exercise', 'link', 'exercise_muscle', 'contraindication', 'report_copy', 'algorithm']),
  slug: z.string().min(1),
  sha256: z.string().regex(SHA256),
}).strict()

export const clinicalInventorySchema = z.object({
  schema_version: z.literal(1),
  inventory_version: z.string().min(1),
  inventory_sha256: z.string().regex(SHA256),
  counts: z.object({
    muscles: z.number().int().nonnegative(),
    exercises: z.number().int().nonnegative(),
    links: z.number().int().nonnegative(),
    exercise_muscles: z.number().int().nonnegative(),
    contraindications: z.number().int().nonnegative(),
    report_copy: z.number().int().nonnegative(),
    algorithms: z.number().int().nonnegative(),
  }).strict(),
  items: z.array(itemSchema),
}).strict()

const reviewedItemSchema = z.object({
  id: z.string().regex(ITEM_ID),
  status: z.enum(['approved', 'rejected']),
  item_sha256: z.string().regex(SHA256),
  reviewed_at: z.string().datetime({ offset: true }),
  reviewer_note: z.string().min(1).max(1000),
}).strict()

const releaseSchema = z.object({
  id: z.string().regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/),
  status: z.literal('approved'),
  inventory_sha256: z.string().regex(SHA256),
  hg03_receipt_sha256: z.string().regex(SHA256),
  approved_at: z.string().datetime({ offset: true }),
  reviewer: z.object({
    name: z.string().min(2),
    license_jurisdiction: z.string().min(2),
    license_identifier: z.string().min(2),
    attestation: z.literal('licensed_clinician'),
  }).strict(),
  surfaces: z.object({
    recommendations: z.boolean(),
    programs: z.boolean(),
    workouts: z.boolean(),
    knowledgeLinks: z.boolean(),
  }).strict(),
  items: z.array(reviewedItemSchema),
}).strict()

export const clinicalReviewLedgerSchema = z.object({
  schema_version: z.literal(1),
  releases: z.array(releaseSchema),
}).strict()

export type ClinicalInventory = z.infer<typeof clinicalInventorySchema>
export type ClinicalReviewLedger = z.infer<typeof clinicalReviewLedgerSchema>

export interface ClinicalContentAccess {
  mode: 'disabled' | 'test_fixture' | 'approved'
  reason: string
  contentVersion: string | null
  inventorySha256: string
  surfaces: ClinicalSurfaceAccess
  approvedItemIds: string[]
  approvedMuscleSlugs: string[]
  approvedExerciseSlugs: string[]
  approvedLinkIds: string[]
  approvedExerciseMuscleIds: string[]
  approvedContraindicationIds: string[]
  approvedReportCopyIds: string[]
  approvedAlgorithmIds: string[]
}

export interface ResolveClinicalContentInput {
  inventory: unknown
  ledger: unknown
  releaseId?: string | null
  hg03ReceiptSha256?: string | null
  testFixtureEnabled?: boolean
}

const DISABLED_SURFACES: ClinicalSurfaceAccess = {
  recommendations: false,
  programs: false,
  workouts: false,
  knowledgeLinks: false,
}

export function disabledClinicalContent(inventorySha256: string, reason: string): ClinicalContentAccess {
  return {
    mode: 'disabled',
    reason,
    contentVersion: null,
    inventorySha256,
    surfaces: { ...DISABLED_SURFACES },
    approvedItemIds: [],
    approvedMuscleSlugs: [],
    approvedExerciseSlugs: [],
    approvedLinkIds: [],
    approvedExerciseMuscleIds: [],
    approvedContraindicationIds: [],
    approvedReportCopyIds: [],
    approvedAlgorithmIds: [],
  }
}

function selectedItems(inventory: ClinicalInventory, ids: Set<string>, kind: ClinicalItemKind) {
  return inventory.items
    .filter((item) => item.kind === kind && ids.has(item.id))
    // Catalog records are addressed by slug at render/selection boundaries.
    // Relationship, copy, contraindication, and algorithm records are addressed
    // by their full inventory id so dependency-closure checks cannot confuse
    // several records that legitimately share the same parent slug.
    .map((item) => item.kind === 'muscle' || item.kind === 'exercise' ? item.slug : item.id)
    .sort()
}

function validateInventoryCounts(inventory: ClinicalInventory): boolean {
  const counts = {
    muscle: 0,
    exercise: 0,
    link: 0,
    exercise_muscle: 0,
    contraindication: 0,
    report_copy: 0,
    algorithm: 0,
  }
  const ids = new Set<string>()
  for (const item of inventory.items) {
    if (ids.has(item.id)) return false
    ids.add(item.id)
    counts[item.kind] += 1
  }
  return counts.muscle === inventory.counts.muscles
    && counts.exercise === inventory.counts.exercises
    && counts.link === inventory.counts.links
    && counts.exercise_muscle === inventory.counts.exercise_muscles
    && counts.contraindication === inventory.counts.contraindications
    && counts.report_copy === inventory.counts.report_copy
    && counts.algorithm === inventory.counts.algorithms
}

/**
 * Resolve the only server-side authority for clinical content. Missing, stale,
 * partial, duplicated, or hash-mismatched approval data always disables every
 * surface. The test fixture path requires an explicit server-only test flag and
 * is separately forbidden by the release-manifest checker.
 */
export function resolveClinicalContentAccess(input: ResolveClinicalContentInput): ClinicalContentAccess {
  const inventoryResult = clinicalInventorySchema.safeParse(input.inventory)
  if (!inventoryResult.success || !validateInventoryCounts(inventoryResult.data)) {
    return disabledClinicalContent('', 'invalid_inventory')
  }
  const inventory = inventoryResult.data

  if (input.testFixtureEnabled === true) {
    const allIds = new Set(inventory.items.map((item) => item.id))
    return {
      mode: 'test_fixture',
      reason: 'explicit_test_fixture',
      contentVersion: 'clinical-content-test-fixture-v1',
      inventorySha256: inventory.inventory_sha256,
      surfaces: {
        recommendations: true,
        programs: true,
        workouts: true,
        knowledgeLinks: true,
      },
      approvedItemIds: [...allIds].sort(),
      approvedMuscleSlugs: selectedItems(inventory, allIds, 'muscle'),
      approvedExerciseSlugs: selectedItems(inventory, allIds, 'exercise'),
      approvedLinkIds: selectedItems(inventory, allIds, 'link'),
      approvedExerciseMuscleIds: selectedItems(inventory, allIds, 'exercise_muscle'),
      approvedContraindicationIds: selectedItems(inventory, allIds, 'contraindication'),
      approvedReportCopyIds: selectedItems(inventory, allIds, 'report_copy'),
      approvedAlgorithmIds: selectedItems(inventory, allIds, 'algorithm'),
    }
  }

  const ledgerResult = clinicalReviewLedgerSchema.safeParse(input.ledger)
  if (!ledgerResult.success) return disabledClinicalContent(inventory.inventory_sha256, 'invalid_review_ledger')
  if (!input.releaseId || !input.hg03ReceiptSha256 || !SHA256.test(input.hg03ReceiptSha256)) {
    return disabledClinicalContent(inventory.inventory_sha256, 'hg03_activation_absent')
  }

  const releases = ledgerResult.data.releases.filter((entry) => entry.id === input.releaseId)
  if (releases.length !== 1) return disabledClinicalContent(inventory.inventory_sha256, 'release_not_unique')
  const release = releases[0]
  if (
    release.inventory_sha256 !== inventory.inventory_sha256
    || release.hg03_receipt_sha256 !== input.hg03ReceiptSha256
  ) return disabledClinicalContent(inventory.inventory_sha256, 'release_provenance_mismatch')

  const inventoryById = new Map(inventory.items.map((item) => [item.id, item]))
  const reviewedIds = new Set<string>()
  const approvedIds = new Set<string>()
  for (const reviewed of release.items) {
    if (reviewedIds.has(reviewed.id)) return disabledClinicalContent(inventory.inventory_sha256, 'duplicate_review_item')
    reviewedIds.add(reviewed.id)
    const item = inventoryById.get(reviewed.id)
    if (!item || item.sha256 !== reviewed.item_sha256) {
      return disabledClinicalContent(inventory.inventory_sha256, 'review_item_hash_mismatch')
    }
    if (reviewed.status === 'approved') approvedIds.add(reviewed.id)
  }

  const approvedMuscleSlugs = selectedItems(inventory, approvedIds, 'muscle')
  const approvedMuscleSet = new Set(approvedMuscleSlugs)
  const approvedContraindicationIds = selectedItems(inventory, approvedIds, 'contraindication')
  const approvedContraindicationSet = new Set(approvedContraindicationIds)
  const approvedExerciseMuscleIds = selectedItems(inventory, approvedIds, 'exercise_muscle')
  const approvedExerciseMuscleSet = new Set(approvedExerciseMuscleIds)
  const approvedExerciseSlugs = selectedItems(inventory, approvedIds, 'exercise').filter((slug) =>
    (() => {
      const exerciseMuscles = inventory.items
        .filter((item) => item.kind === 'exercise_muscle' && item.slug === slug)
      return exerciseMuscles.length > 0 && exerciseMuscles.every((item) => {
        const muscleSlug = item.id.split(':')[2]
        return approvedExerciseMuscleSet.has(item.id)
          && Boolean(muscleSlug)
          && approvedMuscleSet.has(muscleSlug)
      })
    })()
    && inventory.items
      .filter((item) => item.kind === 'contraindication' && item.slug === slug)
      .every((item) => approvedContraindicationSet.has(item.id)),
  )
  const approvedLinkIds = inventory.items
    .filter((item) => item.kind === 'link' && approvedIds.has(item.id) && approvedMuscleSet.has(item.slug))
    .map((item) => item.id)
    .sort()
  const approvedReportCopyIds = selectedItems(inventory, approvedIds, 'report_copy')
  const approvedAlgorithmIds = selectedItems(inventory, approvedIds, 'algorithm')
  const hasReviewedAlgorithm = approvedAlgorithmIds.includes('algorithm:recommendation-engine')
  const hasRecommendationInputs = approvedExerciseSlugs.length > 0
    && approvedMuscleSlugs.length > 0
    && approvedLinkIds.length > 0
    && approvedExerciseMuscleIds.length > 0
    && hasReviewedAlgorithm
  const hasProgramInputs = hasRecommendationInputs && approvedReportCopyIds.length > 0
  const surfaces: ClinicalSurfaceAccess = {
    recommendations: release.surfaces.recommendations && hasRecommendationInputs,
    programs: release.surfaces.programs && hasProgramInputs,
    workouts: release.surfaces.workouts && hasProgramInputs,
    knowledgeLinks: release.surfaces.knowledgeLinks
      && approvedMuscleSlugs.length > 0
      && approvedLinkIds.length > 0,
  }
  if (!Object.values(surfaces).some(Boolean)) {
    return disabledClinicalContent(inventory.inventory_sha256, 'release_approves_no_surface')
  }

  return {
    mode: 'approved',
    reason: 'hg03_release_verified',
    contentVersion: release.id,
    inventorySha256: inventory.inventory_sha256,
    surfaces,
    approvedItemIds: [...approvedIds].sort(),
    approvedMuscleSlugs,
    approvedExerciseSlugs,
    approvedLinkIds,
    approvedExerciseMuscleIds,
    approvedContraindicationIds,
    approvedReportCopyIds,
    approvedAlgorithmIds,
  }
}

export function clinicalLinkId(muscleSlug: string, imbalanceKey: string, role: string): string {
  return `link:${muscleSlug}:${imbalanceKey}:${role}`
}

export function clinicalContraindicationId(exerciseSlug: string, imbalanceKey: string): string {
  return `contraindication:${exerciseSlug}:${imbalanceKey}`
}
