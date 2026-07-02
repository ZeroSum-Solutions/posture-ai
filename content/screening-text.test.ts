import { describe, it, expect } from 'vitest'
import { assertScreeningText, exerciseContentSchema } from './muscles/types'
import { deadBug } from './exercises/dead-bug'

// Phase-0 exports for the workout player (plan §3 + GPT-fix): a reusable
// screening-vocabulary gate for GENERATED strings (voice cues, captions, rating
// copy) — the private screeningText() Zod helper only guards authored content
// files — plus optional media/form/rest fields on exerciseContentSchema so the
// 55 exercise files can adopt demo clips + player cues incrementally.

describe('assertScreeningText', () => {
  it('accepts screening-safe copy unchanged', () => {
    expect(assertScreeningText('Gently tuck your chin and hold.')).toBe(
      'Gently tuck your chin and hold.',
    )
  })

  it.each([
    'This will treat your pain',
    'A diagnosis of forward head posture',
    'This cures poor posture',
    'Ask your patient to lie down',
    'As prescribed by your therapist',
  ])('throws on banned non-screening vocabulary: %s', (text) => {
    expect(() => assertScreeningText(text)).toThrow(/[Bb]anned/)
  })
})

describe('exerciseContentSchema player extensions (optional, additive)', () => {
  it('existing content without the new fields still validates', () => {
    expect(exerciseContentSchema.safeParse(deadBug).success).toBe(true)
  })

  it('accepts media, form cues, and restSecondsBetweenSets', () => {
    const extended = {
      ...deadBug,
      media: { loopUrl: '/demos/dead-bug.mp4', posterUrl: '/demos/dead-bug.jpg' },
      form: {
        alignmentCue: 'Keep your lower back pressed gently into the mat.',
        avoidCue: 'Do not let the ribs flare as the arm lowers.',
      },
      restSecondsBetweenSets: 20,
    }
    const result = exerciseContentSchema.safeParse(extended)
    expect(result.success, JSON.stringify(!result.success && result.error.issues)).toBe(true)
  })

  it('form cues run through the screening-vocabulary lint', () => {
    const bad = {
      ...deadBug,
      form: {
        alignmentCue: 'This exercise treats your back pain effectively.',
        avoidCue: 'Do not let the ribs flare as the arm lowers.',
      },
    }
    expect(exerciseContentSchema.safeParse(bad).success).toBe(false)
  })

  it('rejects an out-of-range rest', () => {
    expect(exerciseContentSchema.safeParse({ ...deadBug, restSecondsBetweenSets: 999 }).success).toBe(false)
  })
})
