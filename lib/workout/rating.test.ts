import { describe, test, expect } from 'vitest'
import { validateRating } from './rating'

const full = {
  clarity: 4,
  pace: 'just_right',
  difficulty: 'just_right',
  feedback_tags: ['clear_cues'],
  notes: 'Loved the calm pacing.',
}

describe('validateRating — movement-education feedback only', () => {
  test('accepts a well-formed rating with notes when notes are allowed', () => {
    const r = validateRating(full, { allowNotes: true })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.clarity).toBe(4)
      expect(r.value.pace).toBe('just_right')
      expect(r.value.difficulty).toBe('just_right')
      expect(r.value.notes).toBe('Loved the calm pacing.')
      expect(r.value.feedback_tags).toEqual(['clear_cues'])
    }
  })

  test('rejects clarity outside 1–5', () => {
    expect(validateRating({ ...full, clarity: 6 }, { allowNotes: true }).ok).toBe(false)
    expect(validateRating({ ...full, clarity: 0 }, { allowNotes: true }).ok).toBe(false)
  })

  test('rejects an unknown pace value', () => {
    expect(validateRating({ ...full, pace: 'medium' }, { allowNotes: true }).ok).toBe(false)
  })

  test('rejects an unknown difficulty value', () => {
    expect(validateRating({ ...full, difficulty: 'brutal' }, { allowNotes: true }).ok).toBe(false)
  })

  test('requires at least one of clarity / pace / difficulty', () => {
    const r = validateRating({ feedback_tags: [], notes: 'hi there' }, { allowNotes: true })
    expect(r.ok).toBe(false)
  })

  test('rejects notes over 500 characters', () => {
    const r = validateRating({ clarity: 3, notes: 'x'.repeat(501) }, { allowNotes: true })
    expect(r.ok).toBe(false)
  })

  test('rejects notes containing a non-screening (clinical) term', () => {
    // "diagnose" is in BANNED_TERM_PATTERNS — a rating note must stay education-only.
    const r = validateRating({ clarity: 3, notes: 'please diagnose my back pain' }, { allowNotes: true })
    expect(r.ok).toBe(false)
  })

  test('trims surrounding whitespace on notes', () => {
    const r = validateRating({ clarity: 3, notes: '  nice and clear  ' }, { allowNotes: true })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.notes).toBe('nice and clear')
  })

  test('drops notes entirely on the public path (allowNotes: false)', () => {
    const r = validateRating(full, { allowNotes: false })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.notes).toBeUndefined()
      expect(r.value.clarity).toBe(4) // the rest still records
    }
  })
})
