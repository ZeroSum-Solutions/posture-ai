import { PROGRAM_LIVE_CATALOG_REGISTRY } from './liveRegistry'
import { resolveSyntheticTrainingCatalog } from './syntheticRegistry'
import {
  TrainingCatalogOriginV1Schema,
  TrainingCatalogV1Schema,
  type TrainingCatalogOriginV1,
  type TrainingCatalogV1,
} from './types'
import { catalogOriginsMatch } from '../contracts/program'
import type { ProgramLiveCatalogRegistryV1 } from '../persistence/program-build'

export interface TrainingCatalogResolverV1 {
  readonly resolve: (
    catalogVersion: string,
    catalogOrigin: TrainingCatalogOriginV1,
  ) => TrainingCatalogV1 | null
}

/**
 * Resolves immutable program catalog identity without crossing execution contexts.
 * Synthetic programs remain bound to the fixed server fixture registry. Authored
 * programs resolve only through the reviewed live registry and their exact version.
 */
export function createTrainingCatalogResolver(
  liveRegistry: ProgramLiveCatalogRegistryV1 = PROGRAM_LIVE_CATALOG_REGISTRY,
): TrainingCatalogResolverV1 {
  return Object.freeze({
    resolve: (catalogVersion: string, rawOrigin: TrainingCatalogOriginV1) => {
      const origin = TrainingCatalogOriginV1Schema.safeParse(rawOrigin)
      if (!origin.success) return null
      if (origin.data.kind === 'synthetic_fixture') {
        return resolveSyntheticTrainingCatalog(catalogVersion, origin.data)
      }

      const selection = liveRegistry.resolve(catalogVersion)
      const catalog = TrainingCatalogV1Schema.safeParse(selection?.catalog)
      if (!catalog.success
        || catalog.data.origin.kind !== 'authored_catalog'
        || catalog.data.catalogVersion !== catalogVersion
        || !catalogOriginsMatch(catalog.data.origin, origin.data)) return null
      return catalog.data
    },
  })
}

export const DEFAULT_TRAINING_CATALOG_RESOLVER = createTrainingCatalogResolver()
