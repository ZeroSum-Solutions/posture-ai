import type { MuscleContent } from './types'

export const sternocleidomastoid: MuscleContent = {
  slug: 'sternocleidomastoid',
  name: 'Sternocleidomastoid',
  region: 'head_neck',
  anatomySummary:
    'The sternocleidomastoid, often shortened to SCM, is the prominent rope-like muscle you can see on the front and side of the neck when you turn your head to one side. It has two lower attachments, one on the top of the breastbone and one on the inner end of the collarbone, and these join to attach behind the ear on the bony bump of the skull. There is one on each side of the neck. Because it runs from the front of the chest up to the back of the skull, it has a strong influence on how the head and neck are carried, and it is easy to see and feel at the surface.',
  functionText:
    'Working on one side, the sternocleidomastoid turns the head to the opposite side and tips it toward the same shoulder. Working together, the two sides bend the neck forward, and when the head is fixed they can assist breathing by lifting the upper ribs. They also help control and steady the head during everyday movement.',
  screeningNotes:
    'Commonly short and overactive in people who hold the head forward or jut the chin, since the upper portion stays engaged to keep the face level while the lower neck bends forward. Over-reliance on the SCM often pairs with under-use of the deeper neck flexors. In screening it is far more often flagged as tight than weak, and one side may carry more tension than the other; resting length and tone are the usual concern.',
  links: [
    {
      imbalanceKey: 'forward_head_posture',
      role: 'tight',
      confidence: 'high',
      rationale:
        'In a forward-head position the lower neck bends forward while the head tips back slightly to keep the eyes level, and the sternocleidomastoid is well placed to drive and hold this combination. Relying on the SCM rather than the deeper neck flexors keeps it short and overactive, and it can become visibly prominent at rest. Easing its tone while rebuilding deep-flexor support helps the head re-center over the spine.',
    },
  ],
  reviewedBy: null,
  reviewedAt: null,
}
