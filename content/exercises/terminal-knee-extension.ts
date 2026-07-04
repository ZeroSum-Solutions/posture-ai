import type { ExerciseContent } from '../muscles/types'

// Entry-level quad/VMO drill — controlled final degrees of knee straightening.
export const terminalKneeExtension: ExerciseContent = {
  slug: 'terminal-knee-extension',
  name: 'Band Terminal Knee Extension',
  category: 'strengthen',
  primaryDeviationKeys: ['genu_varum_valgum_left', 'genu_varum_valgum_right'],
  minZone: 'warning',
  dosageType: 'dynamic',
  reps: { min: 10, max: 15 },
  instructions:
    'Anchor a resistance band at knee height and loop it behind one knee, then step back so the band has tension. With the banded foot flat on the floor, allow that knee a slight bend, then straighten it smoothly against the band, finishing tall without snapping it back. Focus on the inner thigh just above the kneecap doing the final part of the work. Pause 3 seconds in the fully straightened position, soften, and repeat 10-12 times before switching legs.',
  sets: 3,
  holdSeconds: 3,
  steps: [
    'Anchor a band at knee height and loop it behind one knee, then step back to add tension.',
    'Keep that foot flat and let the knee bend slightly to start.',
    'Straighten the knee smoothly against the band, finishing tall without locking it back.',
    'Hold the straightened position for 3 seconds, soften, and repeat on the other side.',
  ],
  form: {
    alignmentCue: 'Feel the inner thigh just above the kneecap finish the last few degrees of straightening.',
    avoidCue: 'Avoid snapping the knee back hard; extend it smoothly under control.',
  },
  muscles: [
    { muscleSlug: 'quadriceps', role: 'strengthen', progressionLevel: 1 },
  ],
}
