import { describe, test, expect } from 'vitest'
import { ALL_EXERCISES } from './index'

// Every playable exercise must carry short coaching cues and discrete steps —
// the player's voice/captions and Up-Next list depend on them. Informational
// items are exempt (never played).
describe('exercise coaching coverage', () => {
  const playable = ALL_EXERCISES.filter((e) => e.category !== 'informational')
  test.each(playable.map((e) => [e.slug, e] as const))('%s has form and steps', (_slug, e) => {
    expect(e.form?.alignmentCue).toBeTruthy()
    expect(e.form?.avoidCue).toBeTruthy()
    expect(e.steps?.length).toBeGreaterThanOrEqual(2)
  })
})
