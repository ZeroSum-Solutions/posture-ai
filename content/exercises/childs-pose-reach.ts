import type { ExerciseContent } from '../muscles/types'

// Whole-back lengthening with an overhead reach for the lats.
export const childsPoseReach: ExerciseContent = {
  slug: 'childs-pose-reach',
  name: "Child's Pose with Overhead Reach",
  category: 'stretch',
  primaryDeviationKeys: ['t1_tilt_backward', 'anterior_pelvic_shift'],
  minZone: 'maintain',
  instructions:
    'Kneel on a mat, sit your hips back toward your heels, and walk your hands forward until your chest sinks toward the floor. Keep the arms long and reach the fingertips as far forward as comfortable to lengthen the sides of the back. Let the spine round gently and breathe into the back ribs. For more side emphasis, walk both hands toward one side and hold. Stay 30 seconds per hold, then slowly rise.',
  sets: 3,
  holdSeconds: 30,
  muscles: [
    { muscleSlug: 'lumbar-erector-spinae', role: 'stretch', progressionLevel: 2 },
    { muscleSlug: 'thoracic-erector-spinae', role: 'stretch', progressionLevel: 1 },
    { muscleSlug: 'latissimus-dorsi', role: 'stretch', progressionLevel: 1 },
  ],
}
