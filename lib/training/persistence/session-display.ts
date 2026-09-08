import { SYNTHETIC_STARTER_CATALOG } from '../catalog/syntheticStarter'
import { TrainingCatalogV1Schema, type TrainingCatalogV1 } from '../catalog/types'
import { catalogOriginsMatch } from '../contracts/program'
import type { TrainingConditioningSessionPrescriptionV1, TrainingSessionPrescriptionV1 } from '../contracts/session'

type Prescription = TrainingSessionPrescriptionV1 | TrainingConditioningSessionPrescriptionV1

function resolveDisplayCatalog(
  prescription: Prescription,
  authoredCatalogs: readonly TrainingCatalogV1[],
): TrainingCatalogV1 | null {
  const catalogVersion = prescription.schemaVersion === 'training-session-prescription.v1'
    ? prescription.catalogVersion
    : prescription.acceptedBout.source.catalogVersion
  if (catalogVersion === SYNTHETIC_STARTER_CATALOG.catalogVersion
    && catalogOriginsMatch(prescription.catalogOrigin, SYNTHETIC_STARTER_CATALOG.origin)) {
    return SYNTHETIC_STARTER_CATALOG
  }
  for (const candidate of authoredCatalogs) {
    const parsed = TrainingCatalogV1Schema.safeParse(candidate)
    if (parsed.success
      && parsed.data.origin.kind === 'authored_catalog'
      && parsed.data.catalogVersion === catalogVersion
      && catalogOriginsMatch(prescription.catalogOrigin, parsed.data.origin)) {
      return parsed.data
    }
  }
  return null
}

/** Resolve copy only from the exact server catalog that authored the prescription. */
export function trainingSessionDisplay(
  prescription: Prescription | null,
  authoredCatalogs: readonly TrainingCatalogV1[] = [],
) {
  const exerciseDisplay: Record<string, { label: string; textInstruction: string; mediaStatus: string }> = {}
  if (!prescription) {
    return { exerciseDisplay, conditioningDisplay: null }
  }
  const catalog = resolveDisplayCatalog(prescription, authoredCatalogs)
  if (!catalog) return { exerciseDisplay, conditioningDisplay: null }
  if (prescription.schemaVersion === 'training-session-prescription.v1') {
    for (const prescribed of prescription.exercises) {
      const exercise = catalog.exercises.find(item => item.exerciseVersionId === prescribed.exerciseVersionId)
      if (exercise) exerciseDisplay[prescribed.exerciseInstanceId] = {
        label: exercise.label, textInstruction: exercise.textInstruction ?? 'Instructions unavailable for this exercise version.', mediaStatus: exercise.mediaStatus,
      }
    }
    return { exerciseDisplay, conditioningDisplay: null }
  }
  const mode = catalog.conditioningModes.find(item => item.modalityId === prescription.acceptedBout.modalityId)
  return { exerciseDisplay, conditioningDisplay: mode ? { label: mode.label, effortCue: mode.effortCue } : null }
}
