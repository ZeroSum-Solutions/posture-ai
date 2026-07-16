import { describe, expect, it } from 'vitest'
import { WORKOUT_COACH_VOICE, workoutCoachCueUrl, workoutCueKey } from './voicePack'

describe('workout Voicebox coach pack', () => {
  it('uses a stable static URL for each exact screening-safe cue', () => {
    const cue = 'Up next, Cat-Cow.'
    expect(workoutCueKey(cue)).toBe(workoutCueKey(cue))
    expect(workoutCoachCueUrl(cue)).toMatch(/^\/audio\/workout-coach-river\/[a-f0-9]{8}\.mp3$/)
    expect(workoutCoachCueUrl('Get ready.')).not.toBe(workoutCoachCueUrl(cue))
  })

  it('records the locally installed Voicebox preset used to build the pack', () => {
    expect(WORKOUT_COACH_VOICE).toEqual({
      name: 'River',
      source: 'Voicebox',
      engine: 'Kokoro 82M',
      presetVoiceId: 'af_river',
    })
  })
})
