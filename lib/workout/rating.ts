/**
 * Validation for post-workout ratings. Ratings are movement-education feedback
 * ONLY — clarity / pace / difficulty / tags / an optional short note — never
 * symptoms or outcomes (that would cross the screening→treatment line the whole
 * product is built to avoid). The note, being the one free-text field, is
 * trimmed, length-capped, and run through the screening-vocabulary gate; the
 * public share-link path drops notes entirely (allowNotes: false).
 */
import { z } from 'zod'
import { assertScreeningText } from '@/content/muscles/types'

export type RatingPace = 'too_slow' | 'just_right' | 'too_fast'
export type RatingDifficulty = 'too_easy' | 'just_right' | 'too_hard'

export interface RatingValue {
  clarity?: number
  pace?: RatingPace
  difficulty?: RatingDifficulty
  feedback_tags: string[]
  notes?: string
}

export type RatingResult = { ok: true; value: RatingValue } | { ok: false; error: string }

const baseSchema = z.object({
  clarity: z.number().int().min(1).max(5).optional(),
  pace: z.enum(['too_slow', 'just_right', 'too_fast']).optional(),
  difficulty: z.enum(['too_easy', 'just_right', 'too_hard']).optional(),
  feedback_tags: z.array(z.string().min(1).max(40)).max(12).optional(),
  notes: z.string().optional(),
}).strict()

export function validateRating(input: unknown, opts: { allowNotes: boolean }): RatingResult {
  const parsed = baseSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid rating' }
  }
  const { clarity, pace, difficulty, feedback_tags, notes } = parsed.data

  if (clarity === undefined && !pace && !difficulty) {
    return { ok: false, error: 'Provide at least clarity, pace, or difficulty.' }
  }

  const value: RatingValue = { feedback_tags: feedback_tags ?? [] }
  if (clarity !== undefined) value.clarity = clarity
  if (pace) value.pace = pace
  if (difficulty) value.difficulty = difficulty

  if (opts.allowNotes && notes !== undefined) {
    const trimmed = notes.trim()
    if (trimmed.length > 0) {
      if (trimmed.length > 500) {
        return { ok: false, error: 'Notes must be 500 characters or fewer.' }
      }
      try {
        assertScreeningText(trimmed)
      } catch {
        return { ok: false, error: 'Notes must stay educational — please remove clinical terms.' }
      }
      value.notes = trimmed
    }
  }

  return { ok: true, value }
}
