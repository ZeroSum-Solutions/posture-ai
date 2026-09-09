import { z } from 'zod'
import { TrainingCatalogOriginV1Schema } from '../catalog/types'

export const TRAINING_LAUNCH_MEDIA_ENTRY_SCHEMA_VERSION = 'training-launch-media-entry.v1' as const
export const TRAINING_LAUNCH_MEDIA_PROJECTION_SCHEMA_VERSION = 'training-launch-media-projection.v1' as const

const stableIdSchema = z.string()
  .trim()
  .min(1)
  .max(160)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/)

const externalHttpsUrlSchema = z.string().url().max(2_048).refine((value) => {
  try {
    return new URL(value).protocol === 'https:'
  } catch {
    return false
  }
}, 'Attribution URLs must use HTTPS')

const sameOriginAssetPathSchema = z.string().min(2).max(1_024).refine((value) => {
  if (!value.startsWith('/') || value.startsWith('//') || /[\\\u0000-\u001f\u007f]/.test(value)) return false
  if (!/^\/(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+$/.test(value)) return false
  return !value.split('/').some(segment => segment === '.' || segment === '..')
}, 'Media assets must use a normalized same-origin absolute path')

export const TrainingLaunchMediaBindingV1Schema = z.object({
  catalogVersion: stableIdSchema,
  catalogOrigin: TrainingCatalogOriginV1Schema,
  exerciseVersionId: stableIdSchema,
}).strict()

const qualifiedReviewSchema = z.object({
  kind: z.literal('qualified_exact_variant'),
  reviewRecordId: stableIdSchema,
  reviewedAt: z.string().datetime({ offset: true }),
}).strict()

const syntheticReviewSchema = z.object({
  kind: z.literal('synthetic_fixture'),
  fixtureId: stableIdSchema,
  fixtureHash: z.string().regex(/^[a-f0-9]{64}$/),
}).strict()

export const TrainingLaunchMediaReviewV1Schema = z.discriminatedUnion('kind', [
  qualifiedReviewSchema,
  syntheticReviewSchema,
])

export const TrainingLaunchMediaSourceV1Schema = z.object({
  rightsRecordId: stableIdSchema,
  provider: z.string().trim().min(1).max(120),
  assetId: stableIdSchema,
  sourcePageUrl: externalHttpsUrlSchema,
  author: z.string().trim().min(1).max(240),
  license: z.object({
    identifier: stableIdSchema,
    name: z.string().trim().min(1).max(240),
    url: externalHttpsUrlSchema,
  }).strict(),
}).strict()

const posterAssetSchema = z.object({
  path: sameOriginAssetPathSchema,
  alt: z.string().trim().min(1).max(500),
  width: z.number().int().min(1).max(8_192),
  height: z.number().int().min(1).max(8_192),
}).strict()

const videoAssetSchema = z.object({
  path: sameOriginAssetPathSchema,
  mimeType: z.enum(['video/mp4', 'video/webm']),
  width: z.number().int().min(1).max(8_192),
  height: z.number().int().min(1).max(8_192),
}).strict()

export const TrainingLaunchMediaAssetsV1Schema = z.object({
  poster: posterAssetSchema.optional(),
  video: videoAssetSchema.optional(),
}).strict().refine(assets => assets.poster !== undefined || assets.video !== undefined, {
  message: 'Available launch media requires a poster or video asset',
})

const registryEntryShape = z.object({
  schemaVersion: z.literal(TRAINING_LAUNCH_MEDIA_ENTRY_SCHEMA_VERSION),
  binding: TrainingLaunchMediaBindingV1Schema,
  review: TrainingLaunchMediaReviewV1Schema,
  source: TrainingLaunchMediaSourceV1Schema,
  assets: TrainingLaunchMediaAssetsV1Schema,
  expiresAt: z.string().datetime({ offset: true }).nullable(),
}).strict()

function reviewMatchesBinding(
  binding: z.infer<typeof TrainingLaunchMediaBindingV1Schema>,
  review: z.infer<typeof TrainingLaunchMediaReviewV1Schema>,
): boolean {
  if (binding.catalogOrigin.kind === 'authored_catalog') {
    return review.kind === 'qualified_exact_variant'
  }
  return review.kind === 'synthetic_fixture'
    && review.fixtureId === binding.catalogOrigin.fixtureId
    && review.fixtureHash === binding.catalogOrigin.fixtureHash
}

export const TrainingLaunchMediaRegistryEntryV1Schema = registryEntryShape.superRefine((entry, ctx) => {
  if (!reviewMatchesBinding(entry.binding, entry.review)) {
    ctx.addIssue({
      code: 'custom',
      message: 'Media review must match the exact catalog origin identity',
      path: ['review'],
    })
  }
})

const projectionBase = {
  schemaVersion: z.literal(TRAINING_LAUNCH_MEDIA_PROJECTION_SCHEMA_VERSION),
  binding: TrainingLaunchMediaBindingV1Schema,
}

const trainingLaunchMediaProjectionV1Schema = z.discriminatedUnion('status', [
  z.object({
    ...projectionBase,
    status: z.literal('available'),
    review: TrainingLaunchMediaReviewV1Schema,
    source: TrainingLaunchMediaSourceV1Schema,
    assets: TrainingLaunchMediaAssetsV1Schema,
    expiresAt: z.string().datetime({ offset: true }).nullable(),
  }).strict(),
  z.object({
    ...projectionBase,
    status: z.literal('expired'),
    review: TrainingLaunchMediaReviewV1Schema,
    source: TrainingLaunchMediaSourceV1Schema,
    expiredAt: z.string().datetime({ offset: true }),
  }).strict(),
  z.object({
    ...projectionBase,
    status: z.literal('missing'),
    reason: z.literal('not_registered'),
  }).strict(),
])

export const TrainingLaunchMediaProjectionV1Schema = trainingLaunchMediaProjectionV1Schema.superRefine((projection, ctx) => {
  if (projection.status !== 'missing' && !reviewMatchesBinding(projection.binding, projection.review)) {
    ctx.addIssue({
      code: 'custom',
      message: 'Media review must match the exact catalog origin identity',
      path: ['review'],
    })
  }
})

export const TrainingLaunchMediaLookupV1Schema = z.object({
  binding: TrainingLaunchMediaBindingV1Schema,
  evaluatedAt: z.string().datetime({ offset: true }),
}).strict()

export type TrainingLaunchMediaBindingV1 = z.infer<typeof TrainingLaunchMediaBindingV1Schema>
export type TrainingLaunchMediaReviewV1 = z.infer<typeof TrainingLaunchMediaReviewV1Schema>
export type TrainingLaunchMediaSourceV1 = z.infer<typeof TrainingLaunchMediaSourceV1Schema>
export type TrainingLaunchMediaAssetsV1 = z.infer<typeof TrainingLaunchMediaAssetsV1Schema>
export type TrainingLaunchMediaRegistryEntryV1 = z.infer<typeof TrainingLaunchMediaRegistryEntryV1Schema>
export type TrainingLaunchMediaProjectionV1 = z.infer<typeof TrainingLaunchMediaProjectionV1Schema>
export type TrainingLaunchMediaLookupV1 = z.infer<typeof TrainingLaunchMediaLookupV1Schema>
