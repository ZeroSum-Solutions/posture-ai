import { z } from 'zod'

export const TRAINING_BUILD_EXPLANATION_SELECTION_VERSION = 'training-build-explanation-selection.v1' as const
export const TRAINING_BUILD_EXPLANATION_PROVIDER_FACTS_VERSION = 'training-build-explanation-provider-facts.v1' as const
export const TRAINING_BUILD_EXPLANATION_VERSION = 'training-build-explanation.v1' as const

const stableIdSchema = z.string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/)

export const TrainingBuildExplanationSelectionV1Schema = z.object({
  schemaVersion: z.literal(TRAINING_BUILD_EXPLANATION_SELECTION_VERSION),
  orderedFactIds: z.array(stableIdSchema).min(1).max(24),
}).strict().superRefine((selection, ctx) => {
  if (new Set(selection.orderedFactIds).size !== selection.orderedFactIds.length) {
    ctx.addIssue({ code: 'custom', message: 'Fact IDs must be unique', path: ['orderedFactIds'] })
  }
})

export const TrainingBuildExplanationBindingV1Schema = z.object({
  buildId: stableIdSchema,
  subjectId: stableIdSchema,
  profileRevision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
}).strict()

const renderedFactSchema = z.object({
  factId: stableIdSchema,
  text: z.string().trim().min(1).max(500),
}).strict()

export const TrainingBuildExplanationProviderFactsV1Schema = z.object({
  schemaVersion: z.literal(TRAINING_BUILD_EXPLANATION_PROVIDER_FACTS_VERSION),
  facts: z.array(renderedFactSchema).min(1).max(24),
}).strict()

export const TrainingBuildExplanationV1Schema = z.object({
  schemaVersion: z.literal(TRAINING_BUILD_EXPLANATION_VERSION),
  binding: TrainingBuildExplanationBindingV1Schema,
  source: z.enum(['provider_selection', 'deterministic_default']),
  fallbackReason: z.enum(['selection_absent', 'selection_invalid']).nullable(),
  facts: z.array(renderedFactSchema).min(1).max(24),
}).strict().superRefine((explanation, ctx) => {
  if (new Set(explanation.facts.map(fact => fact.factId)).size !== explanation.facts.length) {
    ctx.addIssue({ code: 'custom', message: 'Rendered fact IDs must be unique', path: ['facts'] })
  }
  if ((explanation.source === 'provider_selection') !== (explanation.fallbackReason === null)) {
    ctx.addIssue({ code: 'custom', message: 'Only deterministic fallback has a fallback reason' })
  }
})

export type TrainingBuildExplanationSelectionV1 = z.infer<typeof TrainingBuildExplanationSelectionV1Schema>
export type TrainingBuildExplanationBindingV1 = z.infer<typeof TrainingBuildExplanationBindingV1Schema>
export type TrainingBuildExplanationProviderFactsV1 = z.infer<typeof TrainingBuildExplanationProviderFactsV1Schema>
export type TrainingBuildExplanationV1 = z.infer<typeof TrainingBuildExplanationV1Schema>
