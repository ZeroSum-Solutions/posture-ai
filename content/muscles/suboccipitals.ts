import type { MuscleContent } from './types'

// Exemplar content file — the format and tone reference for all muscle entries.
// Screening-only language throughout; side/condition nuance lives in rationales.
export const suboccipitals: MuscleContent = {
  slug: 'suboccipitals',
  name: 'Suboccipitals',
  region: 'head_neck',
  anatomySummary:
    'The suboccipitals are four small paired muscles tucked deep at the very top of the neck, running between the upper two cervical vertebrae (C1 and C2) and the base of the skull. They are short, dense muscles packed with position-sensing nerve endings, which makes them important players in head positioning and balance, not just movement. Because they sit underneath the larger neck muscles, they cannot be seen or easily felt from the surface, but they work constantly whenever the head tips, nods, or rotates a few degrees.',
  functionText:
    'The suboccipitals fine-tune head position: they extend the head on the upper neck (tipping the face upward), assist small rotations, and continuously adjust the skull against gravity. They also feed the nervous system rich positional information that coordinates eye and neck movement.',
  screeningNotes:
    'Commonly short and overactive in people who hold a forward head position — desk workers, frequent phone users, and anyone whose chin pokes forward. When the head sits in front of the shoulders, these muscles stay contracted to keep the eyes level. They are rarely weak in screening contexts; length and tone are the usual concern.',
  links: [
    {
      imbalanceKey: 'forward_head_posture',
      role: 'tight',
      rationale:
        'When the head drifts forward of the shoulders, the eyes still need to stay level, so the suboccipitals hold the skull tipped back in sustained extension. Over time this constant holding shortens them, reinforcing the forward-head position and making it feel "normal" to the client. Releasing and lengthening them helps the head re-center over the spine.',
    },
  ],
  reviewedBy: null,
  reviewedAt: null,
}
