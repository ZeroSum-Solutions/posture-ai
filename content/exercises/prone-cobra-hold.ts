import type { ExerciseContent } from '../muscles/types'

// Isometric prone hold for the upper-back extensors and scapular retractors.
export const proneCobraHold: ExerciseContent = {
  slug: 'prone-cobra-hold',
  name: 'Prone Cobra Hold',
  category: 'strengthen',
  primaryDeviationKeys: ['t1_tilt_backward', 'posterior_imbalanced_shoulders'],
  minZone: 'warning',
  dosageType: 'hold',
  reps: null,
  instructions:
    'Lie face down with your forehead resting lightly on the floor and arms alongside your body. Gently lift your chest and both hands off the floor, rotating your thumbs upward toward the ceiling. Draw your shoulder blades down and back to open the front of your chest, keeping your neck long and gaze toward the floor. Hold this position steadily for 10 seconds while breathing normally, then lower with control. Repeat for 3 holds per set.',
  sets: 3,
  holdSeconds: 10,
  steps: [
    'Lie face down with your forehead resting on the floor and arms relaxed by your sides.',
    'Lift your chest and hands off the floor while rotating your thumbs up toward the ceiling.',
    'Squeeze your shoulder blades down and back, then hold steadily as you breathe.',
    'Lower your chest and hands slowly back to the floor to finish the hold.',
  ],
  form: {
    alignmentCue: 'Keep your neck long and lead the lift from your upper back, not your lower back.',
    avoidCue: 'Avoid cranking your head up or letting your shoulders shrug toward your ears.',
  },
  muscles: [
    { muscleSlug: 'thoracic-erector-spinae', role: 'strengthen', progressionLevel: 2 },
    { muscleSlug: 'lower-trapezius', role: 'strengthen', progressionLevel: 2 },
    { muscleSlug: 'middle-trapezius', role: 'strengthen', progressionLevel: 2 },
  ],
}
