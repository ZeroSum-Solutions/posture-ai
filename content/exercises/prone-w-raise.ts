import type { ExerciseContent } from '../muscles/types'

// Prone bent-elbow raise for the mid-back retractors.
export const proneWRaise: ExerciseContent = {
  slug: 'prone-w-raise',
  name: 'Prone W Raise',
  category: 'strengthen',
  primaryDeviationKeys: ['posterior_imbalanced_shoulders'],
  minZone: 'warning',
  dosageType: 'dynamic',
  reps: { min: 8, max: 12 },
  instructions:
    'Lie face down with your elbows bent and tucked toward your sides so your arms form a "W" shape. Keeping your neck long, lift your arms and chest slightly while squeezing your shoulder blades together and down. Pause briefly at the top to feel the mid-back working, then lower slowly with control. Keep the motion smooth and let your shoulder blades lead rather than your hands. Perform 8-12 controlled repetitions per set.',
  sets: 3,
  holdSeconds: 2,
  steps: [
    'Lie face down with elbows bent and tucked toward your sides, arms forming a "W".',
    'Lift your arms and squeeze your shoulder blades together and down toward your spine.',
    'Pause briefly at the top, then lower your arms slowly back to the floor.',
  ],
  form: {
    alignmentCue: 'Let your shoulder blades lead the motion and keep your neck long throughout.',
    avoidCue: 'Avoid shrugging toward your ears or yanking the movement with your hands.',
  },
  muscles: [
    { muscleSlug: 'middle-trapezius', role: 'strengthen', progressionLevel: 2 },
    { muscleSlug: 'rhomboids', role: 'strengthen', progressionLevel: 2 },
  ],
}
