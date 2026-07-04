import type { ExerciseContent } from '../muscles/types'

// Whole-back lengthening with an overhead reach for the lats.
export const childsPoseReach: ExerciseContent = {
  slug: 'childs-pose-reach',
  name: "Child's Pose with Overhead Reach",
  category: 'stretch',
  primaryDeviationKeys: ['t1_tilt_backward', 'anterior_pelvic_shift'],
  minZone: 'maintain',
  dosageType: 'hold',
  reps: null,
  instructions:
    'Kneel on a mat, sit your hips back toward your heels, and walk your hands forward until your chest sinks toward the floor. Keep the arms long and reach the fingertips as far forward as comfortable to lengthen the sides of the back. Let the spine round gently and breathe into the back ribs. For more side emphasis, walk both hands toward one side and hold. Stay 30 seconds per hold, then slowly rise.',
  sets: 3,
  holdSeconds: 30,
  steps: [
    'Kneel on a mat and sit your hips back toward your heels.',
    'Walk both hands forward until your chest sinks toward the floor and the arms stay long.',
    'Reach the fingertips as far ahead as is comfortable, breathing into the back of the ribs.',
    'Hold about thirty seconds, then walk the hands back and rise slowly to finish.',
  ],
  form: {
    alignmentCue: 'Let the spine round gently and lengthen the sides of the back as you reach forward.',
    avoidCue: 'Avoid forcing the hips all the way to the heels if the knees or ankles feel strained.',
  },
  muscles: [
    { muscleSlug: 'lumbar-erector-spinae', role: 'stretch', progressionLevel: 2 },
    { muscleSlug: 'thoracic-erector-spinae', role: 'stretch', progressionLevel: 1 },
    { muscleSlug: 'latissimus-dorsi', role: 'stretch', progressionLevel: 1 },
  ],
}
