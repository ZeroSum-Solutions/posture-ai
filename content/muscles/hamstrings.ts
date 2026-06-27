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
    'In screening, the hamstrings frequently read as underactive when the glutes are dominant or when the pelvis sways forward, leaving the back of the thigh unable to anchor the pelvis or control the knee. They may benefit from professional evaluation when a client cannot hinge at the hip without the lower back taking over. Both length and strength are worth checking, since a short-but-weak hamstring is common.',
  links: [
    {
      imbalanceKey: 'anterior_pelvic_shift',
      role: 'weak',
      rationale:
        'When the pelvis sways forward of the ankles, the hamstrings (alongside the glutes and deep abdominals) lengthen and lose the leverage to draw the pelvis back over the feet. Prolonged standing sway and a center of mass carried forward leave the back of the thigh underactive, so the front of the hip dominates the standing posture. Strengthening the hamstrings helps pull the pelvis back into a stacked position over the midfoot.',
    },
    {
      imbalanceKey: 'knee_extension_back_knee',
      role: 'weak',
      confidence: 'low',
      rationale:
        'The hamstrings bend the knee and resist it snapping into full extension, so in a back-knee (hyperextended) pattern they often test weak and let the joint settle into its locked end-range. With the quadriceps holding the knee backward and the hamstrings underactive, the joint loses its dynamic brake against hyperextension. Strengthening the hamstrings helps the knee hold a soft, neutral position under load.',
    },
  ],
  reviewedBy: null,
  reviewedAt: null,
}
