import type { MuscleContent } from './types'

export const popliteus: MuscleContent = {
  slug: 'popliteus',
  name: 'Popliteus',
  region: 'knee_leg',
  anatomySummary:
    'The popliteus is a small, flat, triangular muscle deep behind the knee. It runs from the outer edge of the thigh bone (lateral femoral condyle) diagonally down and inward to the back of the shinbone (tibia), sitting beneath the larger calf muscles where it cannot be seen or felt from the surface. Despite its size it has an outsized role at the very start of knee bending. It is sometimes called the "key" of the knee because of the way it frees the joint from a fully straightened, locked position so that flexion can begin. It also adds quiet support to the back and inner corner of the knee during bent-knee positions.',
  functionText:
    'The popliteus unlocks the knee: when the leg is fully straight it rotates the shinbone slightly to release the joint so that bending can start. It also helps stabilize the back and inner side of the knee, supporting the structures there during bent-knee stances and guarding the joint against drifting backward into hyperextension.',
  screeningNotes:
    'Because it initiates unlocking of the knee, the popliteus commonly reads as underactive in clients whose knees rest in a hyperextended, locked-back position — the joint never asks the muscle to do its job. It may benefit from professional evaluation when a knee habitually sits in full extension rather than a soft stance. It is rarely the muscle that screens as short.',
  links: [
    {
      imbalanceKey: 'knee_extension_back_knee',
      role: 'weak',
      confidence: 'low',
      scored: false,
      exclusionReason:
        'Display-only: no causal recurvatum data supports the popliteus inference (Grade C+); it stays on the muscle page as education but is excluded from the scored map alongside the calf and quadriceps links.',
      rationale:
        'The popliteus is responsible for unlocking the knee out of full extension, so in a back-knee (hyperextended) pattern it is frequently underactive — the joint stays locked and the muscle is never recruited to free it. Joint laxity and a backward-shifted center of mass reinforce the locked position and let the popliteus go quiet. Activating it helps the knee break out of its end-range and settle into a softer, neutral alignment.',
    },
  ],
  reviewedBy: null,
  reviewedAt: null,
}
