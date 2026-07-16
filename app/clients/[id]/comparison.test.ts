import { describe, expect, test } from 'vitest'
import {
  initialComparison,
  selectComparisonBase,
  selectComparisonTarget,
  sortAssessmentsChronologically,
} from './comparison'

const assessments = [
  { id: 'newest', assessed_at: '2026-06-03T10:00:00.000Z' },
  { id: 'oldest', assessed_at: '2026-04-01T10:00:00.000Z' },
  { id: 'middle', assessed_at: '2026-05-02T10:00:00.000Z' },
]

describe('assessment comparison chronology', () => {
  test('sorts without mutating the API response and defaults to earliest versus latest', () => {
    const sorted = sortAssessmentsChronologically(assessments)

    expect(sorted.map((assessment) => assessment.id)).toEqual(['oldest', 'middle', 'newest'])
    expect(assessments[0].id).toBe('newest')
    expect(initialComparison(sorted)).toEqual({ baseId: 'oldest', targetId: 'newest' })
  })

  test('repairs After when Before moves to the same or a later assessment', () => {
    const sorted = sortAssessmentsChronologically(assessments)

    expect(selectComparisonBase(sorted, 'middle', 'middle')).toEqual({ baseId: 'middle', targetId: 'newest' })
    expect(selectComparisonBase(sorted, 'middle', 'newest')).toEqual({ baseId: 'newest', targetId: '' })
  })

  test('repairs Before when After moves to the same or an earlier assessment', () => {
    const sorted = sortAssessmentsChronologically(assessments)

    expect(selectComparisonTarget(sorted, 'middle', 'middle')).toEqual({ baseId: 'oldest', targetId: 'middle' })
    expect(selectComparisonTarget(sorted, 'newest', 'oldest')).toEqual({ baseId: '', targetId: 'oldest' })
  })

  test('does not treat two assessments captured at the same instant as Before and After', () => {
    const sameTime = sortAssessmentsChronologically([
      { id: 'a', assessed_at: '2026-04-01T10:00:00.000Z' },
      { id: 'b', assessed_at: '2026-04-01T10:00:00.000Z' },
    ])

    expect(initialComparison(sameTime)).toEqual({ baseId: 'a', targetId: '' })
    expect(selectComparisonBase(sameTime, 'b', 'a')).toEqual({ baseId: 'a', targetId: '' })
  })
})
