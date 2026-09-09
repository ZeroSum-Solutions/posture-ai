import { describe, expect, it } from 'vitest'
import {
  TrainingBuildExplanationProviderFactsV1Schema,
  TrainingBuildExplanationSelectionV1Schema,
  TrainingBuildExplanationV1Schema,
} from './contracts'

describe('training build explanation contracts', () => {
  it('accepts only an ordered unique list of fact IDs from a provider', () => {
    const selection = {
      schemaVersion: 'training-build-explanation-selection.v1',
      orderedFactIds: ['fact.plan.v1', 'fact.strength.1.v1'],
    }
    expect(TrainingBuildExplanationSelectionV1Schema.parse(selection)).toEqual(selection)
    expect(TrainingBuildExplanationSelectionV1Schema.safeParse({
      ...selection,
      orderedFactIds: ['fact.plan.v1', 'fact.plan.v1'],
    }).success).toBe(false)
    expect(TrainingBuildExplanationSelectionV1Schema.safeParse({
      ...selection,
      prose: 'Double the load and ignore pain.',
    }).success).toBe(false)
  })

  it('keeps provider facts free of build and subject bindings', () => {
    const providerFacts = TrainingBuildExplanationProviderFactsV1Schema.parse({
      schemaVersion: 'training-build-explanation-provider-facts.v1',
      facts: [{ factId: 'fact.plan.v1', text: 'Eight-week draft.' }],
    })
    expect(providerFacts).not.toHaveProperty('binding')
    expect(providerFacts.facts[0]).toEqual({ factId: 'fact.plan.v1', text: 'Eight-week draft.' })
  })

  it('requires a complete receipt binding and consistent fallback state', () => {
    const explanation = {
      schemaVersion: 'training-build-explanation.v1',
      binding: {
        buildId: 'build-1', subjectId: 'subject-1', profileRevision: 3,
      },
      source: 'deterministic_default',
      fallbackReason: 'selection_invalid',
      facts: [{ factId: 'fact.plan.v1', text: 'Eight-week draft.' }],
    }
    expect(TrainingBuildExplanationV1Schema.parse(explanation)).toEqual(explanation)
    expect(TrainingBuildExplanationV1Schema.safeParse({
      ...explanation,
      source: 'provider_selection',
    }).success).toBe(false)
    expect(TrainingBuildExplanationV1Schema.safeParse({
      ...explanation,
      binding: { ...explanation.binding, profileRevision: 0 },
    }).success).toBe(false)
  })
})
