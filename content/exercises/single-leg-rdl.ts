import type { ExerciseContent } from '../muscles/types'

// Advanced hip-hinge — hamstrings and glutes with a balance demand.
export const singleLegRdl: ExerciseContent = {
  slug: 'single-leg-rdl',
  name: 'Single-Leg Romanian Deadlift',
  category: 'strengthen',
  primaryDeviationKeys: ['trunk_lean', 'knee_extension_back_knee'],
  minZone: 'warning',
  dosageType: 'dynamic',
  reps: { min: 10, max: 15 },
  isIntegrative: true,
  instructions:
    'Stand on one leg with a soft bend in that knee, the other foot lightly touching the floor behind you. Hinge forward from the hips, letting the back leg extend behind as your torso lowers toward parallel, keeping the spine long and hips level. Reach toward the floor with the opposite hand, pause 3 seconds, then drive through the standing heel and squeeze the glute to return upright. Do 6-8 slow repetitions per leg; hold a light weight to progress.',
  sets: 3,
  holdSeconds: 3,
  steps: [
    'Stand on one leg with a soft bend in that knee, the other toes lightly touching behind you.',
    'Hinge forward from the hips, letting the back leg float up as the torso lowers toward parallel.',
    'Reach toward the floor with the opposite hand and pause for 3 seconds.',
    'Drive through the standing heel and squeeze the glute to stand tall, then repeat on the other side.',
  ],
  form: {
    alignmentCue: 'Keep the spine long and the hips level as your torso and back leg move as one line.',
    avoidCue: 'Avoid rounding the back or letting the hips twist open toward the ceiling.',
  },
  muscles: [
    { muscleSlug: 'hamstrings', role: 'strengthen', progressionLevel: 3 },
    { muscleSlug: 'gluteus-maximus', role: 'strengthen', progressionLevel: 3 },
  ],
}
