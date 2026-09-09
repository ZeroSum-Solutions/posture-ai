import {
  TrainingLaunchMediaLookupV1Schema,
  TrainingLaunchMediaProjectionV1Schema,
  TrainingLaunchMediaRegistryEntryV1Schema,
  type TrainingLaunchMediaBindingV1,
  type TrainingLaunchMediaLookupV1,
  type TrainingLaunchMediaProjectionV1,
  type TrainingLaunchMediaRegistryEntryV1,
} from './contract'

export type TrainingLaunchMediaRegistryV1 = Readonly<{
  resolve: (lookup: TrainingLaunchMediaLookupV1) => TrainingLaunchMediaProjectionV1
}>

function originKey(origin: TrainingLaunchMediaBindingV1['catalogOrigin']): string {
  return origin.kind === 'authored_catalog'
    ? 'authored_catalog'
    : JSON.stringify([
      origin.kind,
      origin.source,
      origin.fixtureId,
      origin.fixtureHash,
      origin.label,
    ])
}

function bindingKey(binding: TrainingLaunchMediaBindingV1): string {
  return JSON.stringify([
    binding.catalogVersion,
    originKey(binding.catalogOrigin),
    binding.exerciseVersionId,
  ])
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child)
    Object.freeze(value)
  }
  return value
}

function missing(binding: TrainingLaunchMediaBindingV1): TrainingLaunchMediaProjectionV1 {
  return deepFreeze(TrainingLaunchMediaProjectionV1Schema.parse({
    schemaVersion: 'training-launch-media-projection.v1',
    status: 'missing',
    binding,
    reason: 'not_registered',
  }))
}

export function createTrainingLaunchMediaRegistry(
  entries: readonly TrainingLaunchMediaRegistryEntryV1[],
): TrainingLaunchMediaRegistryV1 {
  const byBinding = new Map<string, TrainingLaunchMediaRegistryEntryV1>()
  for (const candidate of entries) {
    const entry = deepFreeze(TrainingLaunchMediaRegistryEntryV1Schema.parse(candidate))
    const key = bindingKey(entry.binding)
    if (byBinding.has(key)) throw new Error('Launch media registry bindings must be unique.')
    byBinding.set(key, entry)
  }

  return Object.freeze({
    resolve: (candidate: TrainingLaunchMediaLookupV1): TrainingLaunchMediaProjectionV1 => {
      const lookup = TrainingLaunchMediaLookupV1Schema.parse(candidate)
      const entry = byBinding.get(bindingKey(lookup.binding))
      if (!entry) return missing(lookup.binding)
      if (entry.expiresAt !== null
        && Date.parse(entry.expiresAt) <= Date.parse(lookup.evaluatedAt)) {
        return deepFreeze(TrainingLaunchMediaProjectionV1Schema.parse({
          schemaVersion: 'training-launch-media-projection.v1',
          status: 'expired',
          binding: entry.binding,
          review: entry.review,
          source: entry.source,
          expiredAt: entry.expiresAt,
        }))
      }
      return deepFreeze(TrainingLaunchMediaProjectionV1Schema.parse({
        schemaVersion: 'training-launch-media-projection.v1',
        status: 'available',
        binding: entry.binding,
        review: entry.review,
        source: entry.source,
        assets: entry.assets,
        expiresAt: entry.expiresAt,
      }))
    },
  })
}

export function resolveTrainingLaunchMedia(
  registry: TrainingLaunchMediaRegistryV1,
  lookup: TrainingLaunchMediaLookupV1,
): TrainingLaunchMediaProjectionV1 {
  return registry.resolve(lookup)
}

// Authored entries are added only after their exact variant, review, and rights records are approved.
export const EMPTY_TRAINING_LAUNCH_MEDIA_REGISTRY = createTrainingLaunchMediaRegistry([])
