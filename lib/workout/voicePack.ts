/**
 * Static coach cues generated locally with Voicebox. Keeping the generated
 * audio in `public/` makes the voice available in production without exposing
 * a local Voicebox service or adding a metered TTS dependency at runtime.
 */
export const WORKOUT_COACH_VOICE = {
  name: 'River',
  source: 'Voicebox',
  engine: 'Kokoro 82M',
  presetVoiceId: 'af_river',
} as const

/** Stable FNV-1a key shared by the browser and the generation script. */
export function workoutCueKey(speech: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < speech.length; index += 1) {
    hash ^= speech.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

export function workoutCoachCueUrl(speech: string): string {
  return `/audio/workout-coach-river/${workoutCueKey(speech)}.mp3`
}
