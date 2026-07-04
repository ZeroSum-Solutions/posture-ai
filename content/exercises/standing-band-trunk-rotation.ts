import type { ExerciseContent } from '../muscles/types'

// Loaded trunk rotation driven from the ribs against a chest-height band.
export const standingBandTrunkRotation: ExerciseContent = {
  slug: 'standing-band-trunk-rotation',
  name: 'Standing Band Trunk Rotation',
  category: 'strengthen',
  primaryDeviationKeys: ['pelvic_axial_rotation'],
  minZone: 'warning',
  dosageType: 'dynamic',
  reps: { min: 8, max: 12 },
  instructions:
    'Stand side-on to a band anchored at chest height, feet hip-width apart, holding the band with both hands in front of your chest. Rotate your trunk away from the anchor with control, leading the motion from your ribs rather than pulling with your arms. Pause 2 seconds at the end of the turn, then return slowly to the start. Keep the hips facing forward throughout. Perform 8-12 controlled repetitions, then switch sides.',
  sets: 3,
  holdSeconds: 2,
  steps: [
    'Stand side-on to a chest-height band anchor with feet hip-width apart.',
    'Hold the band with both hands in front of your chest, arms straight.',
    'Rotate your trunk away from the anchor with control, leading from your ribs.',
    'Pause briefly at the end of the turn, then return slowly to the start.',
    'Finish your repetitions, then switch to the other side.',
  ],
  form: {
    alignmentCue: 'Lead the rotation from your ribs and keep your hips facing forward.',
    avoidCue: 'Avoid yanking the band with your arms or twisting from the lower back.',
  },
  muscles: [
    { muscleSlug: 'obliques', role: 'strengthen', progressionLevel: 2 },
  ],
}
