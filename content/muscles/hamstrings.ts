import type { MuscleContent } from './types'

export const hamstrings: MuscleContent = {
  slug: 'hamstrings',
  name: 'Hamstrings',
  region: 'knee_leg',
  anatomySummary:
    'The hamstrings are three muscles on the back of the thigh — the biceps femoris on the outer side and the semitendinosus and semimembranosus on the inner side. They begin on the sitting bone (ischial tuberosity) of the pelvis, run down the back of the thigh, and cross both the hip and the knee before attaching below the knee on the shin. Because they span two joints, they both extend the hip and bend the knee. That dual role makes them important stabilizers linking the pelvis to the lower leg, and it means their length and strength affect posture from the hips all the way down to the knee.',
  functionText:
    'The hamstrings bend the knee and extend the hip, powering walking, running, and standing up from a chair. Working with the glutes, they pull the pelvis out of a forward-tipped position and help hold the trunk upright over the legs. At the knee they also decelerate the lower leg as it swings and resist the joint snapping into full extension.',
  screeningNotes:
    'In screening, hamstrings can show either limited length or poor force control depending on the pattern. In a sway-back or posterior trunk-lean presentation they are commonly held short and tonically active behind the thigh, while back-knee patterns may still reveal weak knee-flexion control. Check both length and strength before loading, especially when a client cannot hinge at the hip without the lower back taking over.',
  links: [
    {
      imbalanceKey: 'trunk_lean',
      role: 'tight',
      confidence: 'low',
      citation: 'Czaprowski 2018 Scoliosis Spinal Disord PMC5836359 (sway-back: hamstrings shortened); Tokunaga 2017 J Phys Ther Sci PMID 28744050',
      rationale:
        'Sway-back classifications describe the hamstrings as shortened in the posterior pelvic-drift pattern, and EMG work reports high hamstring demand when the trunk leans back. That makes this trunk-lean link a short or overactive contributor rather than a weak one. Lengthening the back of the thigh, while pairing it with glute and trunk control, helps the pelvis stack back over the feet instead of bracing behind the knees.',
    },
    {
      imbalanceKey: 'knee_extension_back_knee',
      role: 'weak',
      confidence: 'medium',
      citation: 'Zwick 2010 (J Pediatr Orthop B, PMID 20308923) — kinematic modelling + surface EMG identified elongated, functionally insufficient hamstrings as a main cause of knee recurvatum.',
      rationale:
        'The hamstrings bend the knee and resist it snapping into full extension, so in a back-knee (hyperextended) pattern they often test weak and let the joint settle into its locked end-range. With the quadriceps holding the knee backward and the hamstrings underactive, the joint loses its dynamic brake against hyperextension. Strengthening the hamstrings helps the knee hold a soft, neutral position under load.',
    },
  ],
  reviewedBy: null,
  reviewedAt: null,
}
