import type { ExerciseContent } from '../muscles/types'

// Entry-level quad/VMO drill — controlled final degrees of knee straightening.
export const terminalKneeExtension: ExerciseContent = {
  slug: 'terminal-knee-extension',
  name: 'Band Terminal Knee Extension',
  category: 'strengthen',
  primaryDeviationKeys: ['genu_varum_valgum_left', 'genu_varum_valgum_right'],
  minZone: 'warning',
  instructions:
    'Anchor a resistance band at knee height and loop it behind one knee, then step back so the band has tension. With the banded foot flat on the floor, allow that knee a slight bend, then straighten it smoothly against the band, finishing tall without snapping it back. Focus on the inner thigh just above the kneecap doing the final part of the work. Pause 3 seconds in the fully straightened position, soften, and repeat 10-12 times before switching legs.',
  sets: 3,
  holdSeconds: 3,
  muscles: [
    { muscleSlug: 'quadriceps', role: 'strengthen', progressionLevel: 1 },
  ],
}
