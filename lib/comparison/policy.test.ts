import { describe, expect, it } from 'vitest'
import {
  FIXED_COMPARISON_TOLERANCE,
  areEngineVersionsComparable,
  compareOverallScores,
  compareSeverityPercentages,
  comparisonDecisionText,
  comparisonVersionOptionNote,
  comparisonStatusText,
} from './policy'

const VERSION = '2.0.0'
const TIME_PAIR = { currentAssessedAt: '2026-02-01', priorAssessedAt: '2026-01-01' }

function overall(current: number | null, prior: number | null, currentVersion: string | null = VERSION, priorVersion: string | null = VERSION) {
  return compareOverallScores({
    current,
    prior,
    currentEngineVersion: currentVersion,
    priorEngineVersion: priorVersion,
    ...TIME_PAIR,
  })
}

function severity(current: number | null, prior: number | null, currentVersion: string | null = VERSION, priorVersion: string | null = VERSION) {
  return compareSeverityPercentages({
    current,
    prior,
    currentEngineVersion: currentVersion,
    priorEngineVersion: priorVersion,
    ...TIME_PAIR,
  })
}

describe('central comparison policy', () => {
  it('locks the temporary fallback units and values', () => {
    expect(FIXED_COMPARISON_TOLERANCE).toEqual({
      id: 'fixed-fallback-v1',
      source: 'fixed_fallback',
      overallScorePoints: 3,
      severityPercentagePoints: 5,
    })
  })

  it.each([
    ['score improves at the exact edge', overall(17, 20), 'improved', -3],
    ['score regresses at the exact edge', overall(23, 20), 'regressed', 3],
    ['severity improves at the exact edge', severity(45, 50), 'improved', -5],
    ['severity regresses at the exact edge', severity(55, 50), 'regressed', 5],
  ])('%s', (_name, decision, status, delta) => {
    expect(decision).toMatchObject({ status, reason: 'outside_tolerance', delta })
  })

  it.each([
    ['score just inside downward', overall(17.01, 20), -2.99],
    ['score just inside upward', overall(22.99, 20), 2.99],
    ['severity just inside downward', severity(45.01, 50), -4.99],
    ['severity just inside upward', severity(54.99, 50), 4.99],
  ])('%s is within measurement tolerance', (_name, decision, delta) => {
    expect(decision).toMatchObject({ status: 'within_tolerance', reason: 'inside_tolerance' })
    expect(decision.delta).toBeCloseTo(delta)
  })

  it('distinguishes an unchanged value from a nonzero within-tolerance movement', () => {
    expect(overall(20, 20)).toMatchObject({ status: 'unchanged', reason: 'same_value', delta: 0 })
    expect(overall(21, 20)).toMatchObject({ status: 'within_tolerance', delta: 1 })
  })

  it.each([
    ['missing current version', VERSION, null, 'missing_version'],
    ['missing prior version (legacy row)', null, VERSION, 'missing_version'],
    ['both versions missing', null, null, 'missing_version'],
    ['blank version', ' ', VERSION, 'missing_version'],
    ['unequal versions', '2.0.0', '1.0.0', 'different_version'],
  ])('fails closed for %s', (_name, currentVersion, priorVersion, reason) => {
    expect(overall(10, 90, currentVersion, priorVersion)).toMatchObject({
      status: 'not_comparable',
      reason,
      delta: null,
    })
  })

  it('fails closed for sparse values instead of treating them as zero', () => {
    expect(severity(null, 50)).toMatchObject({ status: 'not_comparable', reason: 'missing_value' })
    expect(severity(50, null)).toMatchObject({ status: 'not_comparable', reason: 'missing_value' })
    expect(severity(Number.NaN, 50)).toMatchObject({ status: 'not_comparable', reason: 'missing_value' })
  })

  it('normalizes PostgREST numeric strings but rejects empty and malformed strings', () => {
    expect(compareOverallScores({
      current: '17', prior: '20', currentEngineVersion: VERSION, priorEngineVersion: VERSION, ...TIME_PAIR,
    })).toMatchObject({ status: 'improved', delta: -3 })
    expect(compareOverallScores({
      current: '', prior: '20', currentEngineVersion: VERSION, priorEngineVersion: VERSION, ...TIME_PAIR,
    })).toMatchObject({ status: 'not_comparable', reason: 'missing_value' })
    expect(compareOverallScores({
      current: 'not-a-number', prior: '20', currentEngineVersion: VERSION, priorEngineVersion: VERSION, ...TIME_PAIR,
    })).toMatchObject({ status: 'not_comparable', reason: 'missing_value' })
  })

  it('fails closed for reverse, equal, invalid, or one-sided timestamps', () => {
    const input = { current: 10, prior: 90, currentEngineVersion: VERSION, priorEngineVersion: VERSION }
    expect(compareOverallScores({
      ...input, currentAssessedAt: '2026-01-01', priorAssessedAt: '2026-02-01',
    })).toMatchObject({ status: 'not_comparable', reason: 'non_chronological' })
    expect(compareOverallScores({
      ...input, currentAssessedAt: '2026-01-01', priorAssessedAt: '2026-01-01',
    })).toMatchObject({ status: 'not_comparable', reason: 'non_chronological' })
    expect(compareOverallScores({
      ...input, currentAssessedAt: 'invalid', priorAssessedAt: '2026-01-01',
    })).toMatchObject({ status: 'not_comparable', reason: 'missing_timestamp' })
    expect(compareOverallScores({
      ...input, currentAssessedAt: '2026-02-01', priorAssessedAt: undefined,
    })).toMatchObject({ status: 'not_comparable', reason: 'missing_timestamp' })
    expect(compareOverallScores({
      ...input, currentAssessedAt: undefined, priorAssessedAt: undefined,
    })).toMatchObject({ status: 'not_comparable', reason: 'missing_timestamp' })
  })

  it('never calls an unreliable finding improved and fails closed on unit mismatch', () => {
    const input = { current: 0, prior: 50, currentEngineVersion: VERSION, priorEngineVersion: VERSION, ...TIME_PAIR }
    expect(compareSeverityPercentages({
      ...input, currentReliable: false, priorReliable: true,
    })).toMatchObject({ status: 'not_comparable', reason: 'unreliable' })
    expect(compareSeverityPercentages({
      ...input, currentReliable: true, priorReliable: true, currentUnit: 'deg', priorUnit: 'cm',
    })).toMatchObject({ status: 'not_comparable', reason: 'unit_mismatch' })
  })

  it('only considers equal, non-empty versions comparable', () => {
    expect(areEngineVersionsComparable('2.0.0', '2.0.0')).toBe(true)
    expect(areEngineVersionsComparable(null, null)).toBe(false)
    expect(areEngineVersionsComparable('2.0.0', null)).toBe(false)
    expect(areEngineVersionsComparable('2.0.0', '1.0.0')).toBe(false)
  })

  it.each([
    ['different', 'v2', 'v1'],
    ['blank', ' ', ' '],
    ['missing', null, null],
  ])('labels a %s selector version as different or missing', (_name, currentVersion, priorVersion) => {
    expect(comparisonVersionOptionNote(currentVersion, priorVersion)).toBe(' (different or missing scoring version)')
  })

  it('exposes the exact shared web/PDF wording', () => {
    expect(comparisonStatusText('improved', 'overall')).toBe('Improved — lower screening score')
    expect(comparisonStatusText('regressed', 'finding')).toBe('Regressed — higher severity')
    expect(comparisonStatusText('within_tolerance', 'finding')).toBe('Within measurement tolerance')
    expect(comparisonStatusText('not_comparable', 'overall')).toBe('Not comparable')
  })

  it.each([
    ['missing_value', compareSeverityPercentages({ current: null, prior: 50, ...TIME_PAIR, currentEngineVersion: VERSION, priorEngineVersion: VERSION }), 'required score or finding reading is unavailable'],
    ['unreliable', compareSeverityPercentages({ current: 0, prior: 50, currentReliable: false, ...TIME_PAIR, currentEngineVersion: VERSION, priorEngineVersion: VERSION }), 'one or both readings are unreliable'],
    ['unit_mismatch', compareSeverityPercentages({ current: 45, prior: 50, currentUnit: 'deg', priorUnit: 'cm', ...TIME_PAIR, currentEngineVersion: VERSION, priorEngineVersion: VERSION }), 'recorded measurement units differ'],
  ])('centralizes the %s reason copy', (_reason, decision, expected) => {
    expect(comparisonDecisionText(decision, 'finding')).toContain(expected)
  })
})
