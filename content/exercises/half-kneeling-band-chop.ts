import type { ExerciseContent } from '../muscles/types'

// Slow, controlled diagonal chop from a high band anchor in half-kneeling.
export const halfKneelingBandChop: ExerciseContent = {
  slug: 'half-kneeling-band-chop',
  name: 'Half-Kneeling Band Chop',
  category: 'strengthen',
  primaryDeviationKeys: ['pelvic_axial_rotation'],
  minZone: 'warning',
  dosageType: 'dynamic',
  reps: { min: 8, max: 12 },
  instructions:
    'Set up in a half-kneeling position with a band anchored high to one side. Hold the band with both hands and draw it down and across your body slowly and with control, keeping the motion smooth rather than ballistic. Pause 2 seconds at the bottom, then guide the band back up with the same control. Keep your hips and torso tall and steady throughout. Perform 8-12 slow repetitions, then switch sides.',
  sets: 3,
  holdSeconds: 2,
  steps: [
    'Set up in a half-kneeling position with a band anchored high to one side.',
    'Hold the band with both hands near the high shoulder.',
    'Draw the band down and across your body slowly, with no momentum or swinging.',
    'Pause briefly at the bottom, then guide the band back up with the same control.',
    'Finish your slow repetitions, then switch to the other side.',
  ],
  form: {
    alignmentCue: 'Keep your hips and torso tall and steady while the arms move the band.',
    avoidCue: 'Avoid making the chop ballistic or letting momentum swing the band.',
  },
  muscles: [
    { muscleSlug: 'obliques', role: 'strengthen', progressionLevel: 2 },
    { muscleSlug: 'deep-abdominals', role: 'strengthen', progressionLevel: 1 },
  ],
}
