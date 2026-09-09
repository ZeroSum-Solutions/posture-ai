import type { ProgramBuildProjectionV1 } from '../persistence/program-build'
import {
  TRAINING_BUILD_EXPLANATION_PROVIDER_FACTS_VERSION,
  TRAINING_BUILD_EXPLANATION_VERSION,
  TrainingBuildExplanationBindingV1Schema,
  TrainingBuildExplanationSelectionV1Schema,
  TrainingBuildExplanationV1Schema,
  type TrainingBuildExplanationBindingV1,
  type TrainingBuildExplanationProviderFactsV1,
  type TrainingBuildExplanationV1,
} from './contracts'

type Draft = Extract<ProgramBuildProjectionV1['result'], { kind: 'draft_program' }>

type TrainingBuildFactMetadataV1 =
  | {
      readonly kind: 'draft_overview'
      readonly cycleLengthWeeks: number
      readonly strengthSessionsPerWeek: number
      readonly conditioningBoutsPerWeek: number
    }
  | { readonly kind: 'draft_phases'; readonly phases: readonly string[] }
  | {
      readonly kind: 'draft_strength_exercise'
      readonly exerciseLabel: string
      readonly exposureType: string
      readonly repRange: { readonly minimum: number; readonly maximum: number }
      readonly targetRir: { readonly minimum: number; readonly maximum: number }
      readonly restSeconds: number
      readonly startingLoadStatus: 'requires_explicit_acceptance'
    }
  | {
      readonly kind: 'draft_conditioning_pattern'
      readonly weekday: string
      readonly durationOfferSeconds: number
      readonly durationStatus: 'requires_explicit_acceptance'
    }

export interface TrainingBuildFactV1 {
  readonly factId: string
  readonly text: string
  readonly metadata: TrainingBuildFactMetadataV1
}

export interface TrainingBuildFactCatalogV1 {
  readonly schemaVersion: 'training-build-fact-catalog.v1'
  readonly binding: TrainingBuildExplanationBindingV1
  readonly facts: readonly TrainingBuildFactV1[]
  readonly deterministicDefaultFactIds: readonly string[]
}

export class TrainingBuildExplanationError extends Error {
  constructor(readonly code: 'draft_unavailable' | 'invalid_projection' | 'invalid_binding') {
    super(code)
    this.name = 'TrainingBuildExplanationError'
  }
}

function requireDraft(projection: ProgramBuildProjectionV1): { buildId: string; draft: Draft } {
  if (!projection.buildId || projection.result.kind !== 'draft_program') {
    throw new TrainingBuildExplanationError('draft_unavailable')
  }
  return { buildId: projection.buildId, draft: projection.result }
}

function profileRevision(draft: Draft): number {
  const value = Number(draft.profileRevisionId)
  if (!Number.isSafeInteger(value) || value <= 0 || String(value) !== draft.profileRevisionId) {
    throw new TrainingBuildExplanationError('invalid_projection')
  }
  return value
}

function strengthFactText(metadata: Extract<TrainingBuildFactMetadataV1, { kind: 'draft_strength_exercise' }>): string {
  return `${metadata.exerciseLabel}: the initial ${metadata.exposureType.replaceAll('_', ' ')} session uses ${metadata.repRange.minimum}-${metadata.repRange.maximum} reps per working set, `
    + `${metadata.targetRir.minimum}-${metadata.targetRir.maximum} reps in reserve, and ${metadata.restSeconds} seconds of rest. `
    + 'Starting load still needs an explicit choice.'
}

function conditioningFactText(
  index: number,
  metadata: Extract<TrainingBuildFactMetadataV1, { kind: 'draft_conditioning_pattern' }>,
): string {
  return `Conditioning slot ${index} is drafted for ${metadata.weekday} with a ${metadata.durationOfferSeconds}-second starting offer. `
    + 'Its duration still needs explicit acceptance.'
}

export function buildTrainingBuildFactCatalog(input: {
  readonly projection: ProgramBuildProjectionV1
}): TrainingBuildFactCatalogV1 {
  const { buildId, draft } = requireDraft(input.projection)
  const firstWeek = draft.weeks[0]
  if (!firstWeek || draft.weeks.length !== draft.cycleLengthWeeks) {
    throw new TrainingBuildExplanationError('invalid_projection')
  }
  const strengthSessionsPerWeek = firstWeek.strengthSessions.length
  const conditioningBoutsPerWeek = firstWeek.conditioningBouts.length
  if (draft.weeks.some(week => (
    week.strengthSessions.length !== strengthSessionsPerWeek
    || week.conditioningBouts.length !== conditioningBoutsPerWeek
  ))) {
    throw new TrainingBuildExplanationError('invalid_projection')
  }

  const bindingResult = TrainingBuildExplanationBindingV1Schema.safeParse({
    buildId,
    subjectId: draft.subjectId,
    profileRevision: profileRevision(draft),
  })
  if (!bindingResult.success) throw new TrainingBuildExplanationError('invalid_binding')

  const overviewMetadata = {
    kind: 'draft_overview' as const,
    cycleLengthWeeks: draft.cycleLengthWeeks,
    strengthSessionsPerWeek,
    conditioningBoutsPerWeek,
  }
  const phases = draft.weeks.map(week => week.phase)
  const facts: TrainingBuildFactV1[] = [{
    factId: 'fact.plan-overview.v1',
    text: `${draft.cycleLengthWeeks}-week draft with ${strengthSessionsPerWeek} strength sessions and `
      + `${conditioningBoutsPerWeek} conditioning slots each week.`,
    metadata: overviewMetadata,
  }, {
    factId: 'fact.phase-outline.v1',
    text: `Draft phases by week: ${phases.map((phase, index) => `${index + 1} ${phase}`).join('; ')}.`,
    metadata: { kind: 'draft_phases', phases },
  }]

  input.projection.calibrations.forEach((item, index) => {
    const exercise = draft.weeks
      .flatMap(week => week.strengthSessions)
      .flatMap(session => session.exercises)
      .find(candidate => candidate.exerciseInstanceId === item.calibration.exerciseInstanceId)
    if (!exercise) throw new TrainingBuildExplanationError('invalid_projection')
    const metadata = {
      kind: 'draft_strength_exercise' as const,
      exerciseLabel: item.exerciseLabel,
      exposureType: exercise.progression.exposureType,
      repRange: exercise.repRange,
      targetRir: exercise.targetRir,
      restSeconds: exercise.restSeconds,
      startingLoadStatus: 'requires_explicit_acceptance' as const,
    }
    facts.push({
      factId: `fact.strength.${index + 1}.v1`,
      text: strengthFactText(metadata),
      metadata,
    })
  })

  firstWeek.conditioningBouts.forEach((bout, index) => {
    const metadata = {
      kind: 'draft_conditioning_pattern' as const,
      weekday: bout.weekday,
      durationOfferSeconds: bout.durationOfferSeconds,
      durationStatus: 'requires_explicit_acceptance' as const,
    }
    facts.push({
      factId: `fact.conditioning.${index + 1}.v1`,
      text: conditioningFactText(index + 1, metadata),
      metadata,
    })
  })

  if (facts.length > 24) throw new TrainingBuildExplanationError('invalid_projection')
  return Object.freeze({
    schemaVersion: 'training-build-fact-catalog.v1',
    binding: bindingResult.data,
    facts: Object.freeze(facts.map(fact => Object.freeze(fact))),
    deterministicDefaultFactIds: Object.freeze(facts.map(fact => fact.factId)),
  })
}

export function toTrainingBuildExplanationProviderFacts(
  catalog: TrainingBuildFactCatalogV1,
): TrainingBuildExplanationProviderFactsV1 {
  return {
    schemaVersion: TRAINING_BUILD_EXPLANATION_PROVIDER_FACTS_VERSION,
    facts: catalog.facts.map(({ factId, text }) => ({ factId, text })),
  }
}

export function renderTrainingBuildExplanation(input: {
  readonly catalog: TrainingBuildFactCatalogV1
  readonly providerSelection?: unknown
}): TrainingBuildExplanationV1 {
  const parsed = TrainingBuildExplanationSelectionV1Schema.safeParse(input.providerSelection)
  const byId = new Map(input.catalog.facts.map(fact => [fact.factId, fact] as const))
  const selected = parsed.success
    ? parsed.data.orderedFactIds.map(factId => byId.get(factId))
    : []
  const providerSelectionIsValid = parsed.success && selected.every(fact => fact !== undefined)
  const orderedIds = providerSelectionIsValid
    ? parsed.data.orderedFactIds
    : input.catalog.deterministicDefaultFactIds
  return TrainingBuildExplanationV1Schema.parse({
    schemaVersion: TRAINING_BUILD_EXPLANATION_VERSION,
    binding: input.catalog.binding,
    source: providerSelectionIsValid ? 'provider_selection' : 'deterministic_default',
    fallbackReason: providerSelectionIsValid
      ? null
      : input.providerSelection === undefined ? 'selection_absent' : 'selection_invalid',
    facts: orderedIds.map(factId => {
      const fact = byId.get(factId)
      if (!fact) throw new TrainingBuildExplanationError('invalid_projection')
      return { factId: fact.factId, text: fact.text }
    }),
  })
}
