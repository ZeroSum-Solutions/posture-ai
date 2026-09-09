import { TrainingCatalogV1Schema } from './types'
import type {
  ProgramCatalogSelectionV1,
  ProgramLiveCatalogRegistryV1,
} from '../persistence/program-build'

function requireRegisteredSelection(selection: ProgramCatalogSelectionV1): void {
  const catalog = TrainingCatalogV1Schema.parse(selection.catalog)
  if (catalog.origin.kind !== 'authored_catalog') {
    throw new Error('Live program registry entries must use an authored catalog.')
  }
  const selectedMode = catalog.conditioningModes.find(
    mode => mode.modalityId === selection.conditioningModalityId,
  )
  if (!selectedMode || selectedMode.lifecycle !== 'active'
    || selectedMode.contentReviewStatus !== 'reviewed') {
    throw new Error('Live program registry conditioning mode must be an active reviewed catalog entry.')
  }
  if (catalog.exercises.some(exercise => exercise.lifecycle === 'active'
    && (exercise.contentReviewStatus !== 'reviewed'
      || exercise.mediaStatus !== 'reviewed_exact_variant'))) {
    throw new Error('Active live program exercises must be reviewed exact variants.')
  }
  if (catalog.conditioningModes.some(mode => mode.lifecycle === 'active'
    && mode.contentReviewStatus !== 'reviewed')) {
    throw new Error('Active live conditioning modes must be reviewed.')
  }
}

export function createProgramLiveCatalogRegistry(
  selections: readonly ProgramCatalogSelectionV1[],
  defaultCatalogVersion?: string,
): ProgramLiveCatalogRegistryV1 {
  const byVersion = new Map<string, ProgramCatalogSelectionV1>()
  for (const selection of selections) {
    requireRegisteredSelection(selection)
    const version = selection.catalog.catalogVersion
    if (byVersion.has(version)) {
      throw new Error('Live program registry catalog versions must be unique.')
    }
    byVersion.set(version, selection)
  }
  if (selections.length > 1 && defaultCatalogVersion === undefined) {
    throw new Error('A live program registry with multiple catalogs requires an explicit default.')
  }
  if (defaultCatalogVersion !== undefined && !byVersion.has(defaultCatalogVersion)) {
    throw new Error('The live program registry default must name a registered catalog version.')
  }
  const defaultSelection = defaultCatalogVersion === undefined
    ? selections[0] ?? null
    : byVersion.get(defaultCatalogVersion) ?? null
  return Object.freeze({
    resolve: (catalogVersion?: string) => catalogVersion === undefined
      ? defaultSelection
      : byVersion.get(catalogVersion) ?? null,
  })
}

// Authored catalogs are added here only after their exact variants and provenance are reviewed.
export const PROGRAM_LIVE_CATALOG_REGISTRY = createProgramLiveCatalogRegistry([])
