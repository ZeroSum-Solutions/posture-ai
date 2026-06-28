import type { MuscleContent } from './types'

export const quadriceps: MuscleContent = {
  slug: 'quadriceps',
  name: 'Quadriceps (incl. VMO)',
  region: 'knee_leg',
  anatomySummary:
    'The quadriceps are a group of four muscles on the front of the thigh — three vastus muscles (lateralis, medialis, intermedius) and the rectus femoris on top. They join into a common tendon that wraps the kneecap (patella) and attaches onto the top of the shinbone, so together they straighten the knee. The rectus femoris also crosses the hip and helps lift the thigh. The vastus medialis oblique (VMO), the teardrop of muscle just above and inside the kneecap, is singled out here because it steers how the patella tracks and tends to fade first when the inner thigh is underused. As a group the quadriceps span from the pelvis and upper thigh bone down across the knee.',
  functionText:
    'The quadriceps extend (straighten) the knee in every push-off, squat, stair climb, and stand-up, while the rectus femoris head also helps flex the hip. Beyond producing motion they act as a brake, controlling the speed of knee bending as you sit down or step downstairs, and the VMO steadies the kneecap so it glides cleanly through its groove.',
  screeningNotes:
    'The quadriceps often read as short and overactive in clients who lock the knees backward or stand with weight shifted onto the front of the thigh. They can also test underactive on the inner-knee VMO side when alignment drifts. Screening looks at both the resting knee position and how the kneecap tracks; this group may benefit from professional evaluation when one knee consistently hyperextends or the kneecap drifts off-center.',
  links: [
    {
      imbalanceKey: 'knee_extension_back_knee',
      role: 'tight',
      confidence: 'low',
      scored: false,
      exclusionReason:
        'Display-only: the quadriceps to recurvatum inference is the weakest of the four (Grade D) and could not be supported in the 2026-06-27 evidence scan, so it is kept educational and excluded from the scored map.',
      rationale:
        'In a back-knee (hyperextended) standing pattern, the quadriceps hold the knee jammed into full extension rather than letting it rest in a soft, neutral position. High heels, joint laxity, and a center of mass carried backward all push the knee into this locked posture, and the quadriceps shorten to keep it there. Releasing front-thigh tension helps the knee settle out of its locked end-range.',
    },
    {
      imbalanceKey: 'genu_varum_valgum_left',
      role: 'weak',
      rationale:
        'When the left knee drifts into a bowed or knock-kneed alignment, the quadriceps — particularly the vastus medialis oblique (VMO) on the inner knee — often test underactive and stop steering the kneecap. A weak VMO lets the patella slide off-track and the knee collapse toward the midline or bow outward. Strengthening the inner quad helps the left kneecap track centrally and supports a more vertical knee line.',
    },
    {
      imbalanceKey: 'genu_varum_valgum_right',
      role: 'weak',
      rationale:
        'When the right knee drifts into a bowed or knock-kneed alignment, the quadriceps — particularly the vastus medialis oblique (VMO) on the inner knee — often test underactive and stop steering the kneecap. A weak VMO lets the patella slide off-track and the knee collapse toward the midline or bow outward. Strengthening the inner quad helps the right kneecap track centrally and supports a more vertical knee line.',
    },
  ],
  reviewedBy: null,
  reviewedAt: null,
}
