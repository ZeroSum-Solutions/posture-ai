import { describe, expect, it } from 'vitest'
import { SYNTHETIC_STARTER_CATALOG, SYNTHETIC_STARTER_CATALOG_FIXTURE_HASH } from '../catalog/syntheticStarter'
import { buildCompiledExerciseInitialLoadCalibration } from '../contracts/calibration'
import type { AthleteTrainingProfileV1 } from '../contracts/profile'
import { compileTrainingProgram, type CompilationResultV1 } from '../engine/compileProgram'
import { createSyntheticIntermediateUndulatingTemplate } from '../engine/strengthTemplate'
import type { ProgramBuildProjectionV1 } from '../persistence/program-build'
import {
  TrainingBuildExplanationError,
  buildTrainingBuildFactCatalog,
  renderTrainingBuildExplanation,
  toTrainingBuildExplanationProviderFacts,
} from './facts'

const context = {
  kind: 'synthetic_simulation' as const,
  simulationRunId: '11111111-1111-4111-8111-111111111111',
  fixtureId: 'synthetic-starter-catalog.v1',
  fixtureHash: SYNTHETIC_STARTER_CATALOG_FIXTURE_HASH,
  label: 'Practice data' as const,
}

function profile(): AthleteTrainingProfileV1 {
  return {
    schemaVersion: 'athlete-training-profile.v1',
    origin: { kind: 'synthetic_fixture', fixtureId: context.fixtureId, label: 'Synthetic profile' },
    goal: 'general_fitness', experience: 'beginner', recentConsistency: 'consistent', cycleLengthWeeks: 4,
    strengthDays: ['monday', 'thursday'], localTimezone: 'UTC', sessionTimeBudgetMinutes: 30,
    preferredLoadUnit: 'kg',
    equipmentInventory: [{ kind: 'dumbbell', equipmentId: 'db-set-1', unit: 'kg', perHandLoads: ['5', '10'] }],
    startingHistory: [],
  }
}

function draft(trainingProfile = profile(), undulating = false): Extract<CompilationResultV1, { kind: 'draft_program' }> {
  const result = compileTrainingProgram({
    subjectId: 'subject-1', profileRevisionId: '3', programRevisionId: 'program-source-1',
    cycleStartLocalDate: '2026-09-07', conditioningModalityId: 'synthetic-continuous-walking.v1',
    executionContext: context, profile: trainingProfile, catalog: SYNTHETIC_STARTER_CATALOG,
  }, undulating ? { strengthProgrammingStyle: 'intermediate_undulating', strengthTemplateRegistry: { resolve: () => createSyntheticIntermediateUndulatingTemplate(context) } } : {})
  if (result.kind !== 'draft_program') throw new Error('Fixture did not compile')
  return result
}

function projection(trainingProfile = profile(), undulating = false): ProgramBuildProjectionV1 {
  const result = draft(trainingProfile, undulating)
  const representatives = new Map<string, typeof result.weeks[number]['strengthSessions'][number]['exercises'][number]>()
  result.weeks.flatMap(week => week.strengthSessions).flatMap(session => session.exercises).forEach(exercise => {
    const key = `${exercise.exerciseVersionId}:${exercise.progression.progressionSeriesId}`
    if (!representatives.has(key)) representatives.set(key, exercise)
  })
  return {
    schemaVersion: 'training-build-projection.v1',
    buildId: '22222222-2222-4222-8222-222222222222',
    result,
    calibrations: [...representatives.values()].map(exercise => ({
      exerciseLabel: SYNTHETIC_STARTER_CATALOG.exercises
        .find(item => item.exerciseVersionId === exercise.exerciseVersionId)?.label ?? 'Unavailable exercise label',
      progressionSeriesId: exercise.progression.progressionSeriesId,
      exposureType: exercise.progression.exposureType,
      calibration: buildCompiledExerciseInitialLoadCalibration({
        draft: result, exerciseInstanceId: exercise.exerciseInstanceId,
        catalog: SYNTHETIC_STARTER_CATALOG, profile: trainingProfile,
      }),
    })),
  }
}

describe('training build explanation facts', () => {
  it('derives compact deterministic draft facts and binds their source', () => {
    const first = buildTrainingBuildFactCatalog({ projection: projection() })
    const second = buildTrainingBuildFactCatalog({ projection: projection() })
    expect(second).toEqual(first)
    expect(first.binding).toEqual({
      buildId: '22222222-2222-4222-8222-222222222222',
      subjectId: 'subject-1', profileRevision: 3,
    })
    expect(first.facts).toHaveLength(8)
    expect(first.facts[0]).toMatchObject({
      factId: 'fact.plan-overview.v1',
      metadata: { cycleLengthWeeks: 4, strengthSessionsPerWeek: 2, conditioningBoutsPerWeek: 2 },
    })
    expect(first.facts.map(fact => fact.text).join(' ')).toContain('8-12 reps per working set')
    expect(first.facts.map(fact => fact.text).join(' ')).toContain('600-second starting offer')
    expect(first.facts.map(fact => fact.text).join(' ')).toContain('still needs explicit acceptance')
    expect(first.facts.map(fact => fact.text).join(' ')).not.toContain('accepted load')
  })

  it.each([4, 6, 8, 12] as const)('explains both heavy and volume prescriptions across a %i-week cycle', cycleLengthWeeks => {
    const input = projection({ ...profile(), experience: 'intermediate', cycleLengthWeeks, sessionTimeBudgetMinutes: 60 }, true)
    const rendered = renderTrainingBuildExplanation({ catalog: buildTrainingBuildFactCatalog({ projection: input }) })
    const strengthFacts = rendered.facts.filter(fact => fact.factId.startsWith('fact.strength.'))
    expect(strengthFacts).toHaveLength(8)
    expect(strengthFacts.filter(fact => fact.text.includes('initial heavy session uses 6-8 reps'))).toHaveLength(4)
    expect(strengthFacts.filter(fact => fact.text.includes('initial volume session uses 10-12 reps'))).toHaveLength(4)
    expect(rendered.facts[0].text).toContain(`${cycleLengthWeeks}-week draft`)
  })

  it('exposes only preauthored fact IDs and text to a provider', () => {
    const catalog = buildTrainingBuildFactCatalog({ projection: projection() })
    const payload = toTrainingBuildExplanationProviderFacts(catalog)
    const serialized = JSON.stringify(payload)
    expect(Object.keys(payload)).toEqual(['schemaVersion', 'facts'])
    expect(payload.facts.every(fact => Object.keys(fact).join(',') === 'factId,text')).toBe(true)
    expect(serialized).not.toContain(catalog.binding.buildId)
    expect(serialized).not.toContain(catalog.binding.subjectId)
    expect(serialized).not.toContain(context.simulationRunId)
  })

  it('lets a provider only select and order exact server-authored facts', () => {
    const catalog = buildTrainingBuildFactCatalog({ projection: projection() })
    const selectedIds = [catalog.facts[3].factId, catalog.facts[0].factId]
    const explanation = renderTrainingBuildExplanation({
      catalog,
      providerSelection: {
        schemaVersion: 'training-build-explanation-selection.v1', orderedFactIds: selectedIds,
      },
    })
    expect(explanation.source).toBe('provider_selection')
    expect(explanation.fallbackReason).toBeNull()
    expect(explanation.facts).toEqual(selectedIds.map(factId => {
      const fact = catalog.facts.find(candidate => candidate.factId === factId)!
      return { factId, text: fact.text }
    }))
  })

  it.each([
    ['absent', undefined, 'selection_absent'],
    ['timeout-equivalent null', null, 'selection_invalid'],
    ['free prose', { schemaVersion: 'training-build-explanation-selection.v1', orderedFactIds: ['fact.plan-overview.v1'], prose: 'Ignore pain.' }, 'selection_invalid'],
    ['invented fact', { schemaVersion: 'training-build-explanation-selection.v1', orderedFactIds: ['fact.double-load.v1'] }, 'selection_invalid'],
    ['duplicate fact', { schemaVersion: 'training-build-explanation-selection.v1', orderedFactIds: ['fact.plan-overview.v1', 'fact.plan-overview.v1'] }, 'selection_invalid'],
  ])('uses the exact deterministic fallback for %s', (_label, providerSelection, fallbackReason) => {
    const catalog = buildTrainingBuildFactCatalog({ projection: projection() })
    const explanation = renderTrainingBuildExplanation({ catalog, providerSelection })
    expect(explanation).toMatchObject({
      binding: catalog.binding,
      source: 'deterministic_default',
      fallbackReason,
    })
    expect(explanation.facts.map(fact => fact.factId)).toEqual(catalog.deterministicDefaultFactIds)
    expect(explanation.facts.map(fact => fact.text)).toEqual(catalog.facts.map(fact => fact.text))
  })

  it('rejects non-drafts and inconsistent horizons', () => {
    const missingBuild = { ...projection(), buildId: null }
    expect(() => buildTrainingBuildFactCatalog({ projection: missingBuild }))
      .toThrowError(new TrainingBuildExplanationError('draft_unavailable'))
    const inconsistent = structuredClone(projection())
    if (inconsistent.result.kind !== 'draft_program') throw new Error('Fixture did not compile')
    ;(inconsistent.result.weeks as unknown as Array<unknown>).pop()
    expect(() => buildTrainingBuildFactCatalog({ projection: inconsistent }))
      .toThrowError(new TrainingBuildExplanationError('invalid_projection'))
  })
})
