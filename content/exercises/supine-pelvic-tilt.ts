import type { ExerciseContent } from '../muscles/types'

// Entry-level deep abdominal drill — learning to control pelvic position.
export const supinePelvicTilt: ExerciseContent = {
  slug: 'supine-pelvic-tilt',
  name: 'Supine Pelvic Tilt',
  category: 'activation',
  primaryDeviationKeys: ['anterior_pelvic_shift'],
  minZone: 'warning',
  dosageType: 'dynamic',
  reps: { min: 10, max: 15 },
  instructions:
    'Lie on your back with knees bent and feet flat, arms relaxed at your sides. Gently draw your lower abdomen in and tilt the pelvis so the lower back presses lightly into the floor — imagine pulling the front hip bones toward the ribs. Hold 5 seconds while breathing steadily (do not hold your breath), then relax back to the starting position. Keep the glutes mostly relaxed so the abdominals do the work. Repeat 10 times per set.',
  sets: 3,
  holdSeconds: 5,
  steps: [
    'Lie on your back with knees bent, feet flat, and arms relaxed at your sides.',
    'Gently draw your lower abdomen in and tilt your pelvis so the low back presses into the floor.',
    'Imagine drawing your front hip bones toward your ribs as you settle in.',
    'Hold for five seconds while breathing steadily and keeping your glutes soft.',
    'Release smoothly back to the resting position.',
  ],
  form: {
    alignmentCue: 'Let your abdominals flatten the low back into the floor while you keep breathing.',
    avoidCue: 'Avoid holding your breath or squeezing your glutes to make the tilt happen.',
  },
  muscles: [
    { muscleSlug: 'deep-abdominals', role: 'strengthen', progressionLevel: 1 },
  ],
}
