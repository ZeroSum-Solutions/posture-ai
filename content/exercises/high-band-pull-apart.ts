import type { ExerciseContent } from '../muscles/types'

// Overhead-to-V band pull for the lower trapezius and mid-back retractors.
export const highBandPullApart: ExerciseContent = {
  slug: 'high-band-pull-apart',
  name: 'High Band Pull-Apart',
  category: 'strengthen',
  primaryDeviationKeys: ['posterior_imbalanced_shoulders'],
  minZone: 'warning',
  dosageType: 'dynamic',
  reps: { min: 10, max: 15 },
  instructions:
    'Stand tall holding a light resistance band overhead at about eye or forehead level, hands roughly shoulder-width apart. Pull the band apart and downward, sweeping your arms into a wide "V" while drawing your shoulder blades down toward your back pockets. Pause briefly at the bottom of the V, then return the band overhead with control. Keep your ribs down and your neck relaxed throughout. Perform 10-15 controlled repetitions per set.',
  sets: 3,
  holdSeconds: 2,
  steps: [
    'Stand tall and hold a light band overhead at about eye or forehead level.',
    'Pull the band apart and down into a wide "V", drawing your shoulder blades down.',
    'Pause briefly at the bottom, then return the band overhead slowly and with control.',
  ],
  form: {
    alignmentCue: 'Keep your ribs down and pull your shoulder blades toward your back pockets.',
    avoidCue: 'Avoid arching your lower back or shrugging your shoulders toward your ears.',
  },
  muscles: [
    { muscleSlug: 'lower-trapezius', role: 'strengthen', progressionLevel: 2 },
    { muscleSlug: 'middle-trapezius', role: 'strengthen', progressionLevel: 2 },
    { muscleSlug: 'rhomboids', role: 'strengthen', progressionLevel: 2 },
  ],
}
