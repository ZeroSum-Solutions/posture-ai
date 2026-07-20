import { describe, expect, it } from 'vitest'
import { ENGINE_VERSION } from '@posture-ai/engine'
import { GRADE_BANDS, toGrade } from '@posture-ai/engine/thresholds'
import {
  GRADE_DISPLAY_BANDS,
  getGradeDisplayBand,
  getGradeDisplayForScore,
  usesCurrentGradeScale,
} from './grade-display'

const EXPECTED_BANDS = [
  { grade: 'S', min: 0, max: 3, range: '0–3' },
  { grade: 'A', min: 4, max: 7, range: '4–7' },
  { grade: 'B', min: 8, max: 20, range: '8–20' },
  { grade: 'C', min: 21, max: 55, range: '21–55' },
  { grade: 'D', min: 56, max: 87, range: '56–87' },
  { grade: 'E', min: 88, max: 100, range: '88–100' },
] as const

describe('grade display projection', () => {
  it('derives all six exact integer ranges from the engine thresholds', () => {
    expect(GRADE_DISPLAY_BANDS.map(({ grade, min, max, range }) => ({ grade, min, max, range })))
      .toEqual(EXPECTED_BANDS)
    expect(GRADE_DISPLAY_BANDS.map(({ grade, max }) => ({ grade, max })))
      .toEqual(GRADE_BANDS)
  })

  it.each(EXPECTED_BANDS)(
    'keeps both endpoints inside the $grade band ($range)',
    ({ grade, min, max }) => {
      expect(toGrade(min)).toBe(grade)
      expect(toGrade(max)).toBe(grade)
      expect(getGradeDisplayForScore(min).grade).toBe(grade)
      expect(getGradeDisplayForScore(max).grade).toBe(grade)
    },
  )

  it.each(EXPECTED_BANDS.slice(0, -1))(
    'moves to the next band immediately after $grade ends at $max',
    ({ grade, max }) => {
      const currentIndex = EXPECTED_BANDS.findIndex(band => band.grade === grade)
      const next = EXPECTED_BANDS[currentIndex + 1]

      expect(getGradeDisplayForScore(max + 1).grade).toBe(next.grade)
      expect(getGradeDisplayForScore(max + 1).min).toBe(max + 1)
    },
  )

  it('maps score 14 to grade B and the 8–20 display range', () => {
    expect(getGradeDisplayForScore(14)).toMatchObject({
      grade: 'B',
      min: 8,
      max: 20,
      range: '8–20',
    })
  })

  it('provides neutral descriptions and stable semantic color metadata', () => {
    expect(GRADE_DISPLAY_BANDS.map(({ description }) => description)).toEqual([
      'Minimal deviation',
      'Low deviation',
      'Mild deviation',
      'Moderate deviation',
      'High deviation',
      'Very high deviation',
    ])
    expect(GRADE_DISPLAY_BANDS.map(({ tone, colorToken, hexColor }) => ({ tone, colorToken, hexColor }))).toEqual([
      { tone: 'maintain', colorToken: '--maintain', hexColor: '#5BD5AC' },
      { tone: 'maintain', colorToken: '--maintain', hexColor: '#5BD5AC' },
      { tone: 'warning', colorToken: '--warning', hexColor: '#FF8918' },
      { tone: 'warning', colorToken: '--warning', hexColor: '#FF8918' },
      { tone: 'danger', colorToken: '--danger', hexColor: '#DA4E24' },
      { tone: 'danger', colorToken: '--danger', hexColor: '#DA4E24' },
    ])

    const copy = GRADE_DISPLAY_BANDS.map(({ description }) => description).join(' ').toLowerCase()
    for (const banned of ['elite', 'excellent', 'good', 'fair', 'poor', 'critical']) {
      expect(copy).not.toContain(banned)
    }
  })

  it.each([
    { score: 2, grade: 'S' },
    { score: 3, grade: 'S' },
    { score: 4, grade: 'A' },
    { score: 6, grade: 'A' },
    { score: 7, grade: 'A' },
    { score: 8, grade: 'B' },
    { score: 19, grade: 'B' },
    { score: 20, grade: 'B' },
    { score: 21, grade: 'C' },
    { score: 54, grade: 'C' },
    { score: 55, grade: 'C' },
    { score: 56, grade: 'D' },
    { score: 86, grade: 'D' },
    { score: 87, grade: 'D' },
    { score: 88, grade: 'E' },
    { score: 99, grade: 'E' },
    { score: 100, grade: 'E' },
  ] as const)('pins the inside, edge, and next-band values at score $score', ({ score, grade }) => {
    expect(getGradeDisplayForScore(score).grade).toBe(grade)
  })

  it('returns the same immutable projection object for a grade lookup', () => {
    const band = getGradeDisplayBand('B')

    expect(band).toBe(GRADE_DISPLAY_BANDS[2])
    expect(Object.isFrozen(GRADE_DISPLAY_BANDS)).toBe(true)
    expect(Object.isFrozen(band)).toBe(true)
  })

  it('applies current ranges only to the matching persisted engine version', () => {
    expect(usesCurrentGradeScale(ENGINE_VERSION)).toBe(true)
    expect(usesCurrentGradeScale('1.0.0')).toBe(false)
    expect(usesCurrentGradeScale(null)).toBe(false)
  })
})
