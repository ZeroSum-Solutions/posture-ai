import {
  DEFAULT_TRAINING_CATALOG_RESOLVER,
  type TrainingCatalogResolverV1,
} from '../catalog/contextRegistry'
import type { TrainingConditioningSessionPrescriptionV1, TrainingSessionPrescriptionV1 } from '../contracts/session'
import {
  EMPTY_TRAINING_LAUNCH_MEDIA_REGISTRY,
  resolveTrainingLaunchMedia,
  type TrainingLaunchMediaRegistryV1,
} from '../media/registry'

type Prescription = TrainingSessionPrescriptionV1 | TrainingConditioningSessionPrescriptionV1

function resolveDisplayCatalog(
  prescription: Prescription,
  registry: TrainingCatalogResolverV1,
) {
  const catalogVersion = prescription.schemaVersion === 'training-session-prescription.v1'
    ? prescription.catalogVersion
    : prescription.acceptedBout.source.catalogVersion
  return registry.resolve(catalogVersion, prescription.catalogOrigin)
}

/** Resolve copy only from the exact server catalog that authored the prescription. */
export function trainingSessionDisplay(
  prescription: Prescription | null,
  registry: TrainingCatalogResolverV1 = DEFAULT_TRAINING_CATALOG_RESOLVER,
  mediaRegistry: TrainingLaunchMediaRegistryV1 = EMPTY_TRAINING_LAUNCH_MEDIA_REGISTRY,
  evaluatedAt = new Date().toISOString(),
) {
  const exerciseDisplay: Record<string, {
    label: string
    textInstruction: string
    mediaStatus: 'reviewed_exact_variant' | 'reviewed_static_fixture' | 'missing'
    media: ReturnType<typeof resolveTrainingLaunchMedia>
  }> = {}
  if (!prescription) {
    return { exerciseDisplay, conditioningDisplay: null }
  }
  const catalog = resolveDisplayCatalog(prescription, registry)
  if (!catalog) return { exerciseDisplay, conditioningDisplay: null }
  if (prescription.schemaVersion === 'training-session-prescription.v1') {
    for (const prescribed of prescription.exercises) {
      const exercise = catalog.exercises.find(item => item.exerciseVersionId === prescribed.exerciseVersionId)
      if (exercise) {
        const binding = {
          catalogVersion: prescription.catalogVersion,
          catalogOrigin: prescription.catalogOrigin,
          exerciseVersionId: prescribed.exerciseVersionId,
        }
        exerciseDisplay[prescribed.exerciseInstanceId] = {
          label: exercise.label,
          textInstruction: exercise.textInstruction ?? 'Instructions unavailable for this exercise version.',
          mediaStatus: exercise.mediaStatus,
          media: resolveTrainingLaunchMedia(mediaRegistry, { binding, evaluatedAt }),
        }
      }
    }
    return { exerciseDisplay, conditioningDisplay: null }
  }
  const mode = catalog.conditioningModes.find(item => item.modalityId === prescription.acceptedBout.modalityId)
  return { exerciseDisplay, conditioningDisplay: mode ? { label: mode.label, effortCue: mode.effortCue } : null }
}
