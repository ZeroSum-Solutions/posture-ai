import type { MuscleContent } from './types'

export const anteriorDeltoid: MuscleContent = {
  slug: 'anterior-deltoid',
  name: 'Anterior Deltoid',
  region: 'shoulder_girdle',
  anatomySummary:
    'The anterior deltoid is the front portion of the three-part deltoid muscle that caps the shoulder. It runs from the outer end of the collarbone down to a point on the side of the upper arm bone (the deltoid tuberosity). Sitting right over the front of the shoulder joint, it is easy to see and feel as the rounded muscle at the front of the shoulder. It works closely with the chest muscles during pushing tasks and is often heavily developed by pressing and front-raise style training, which can leave it dominant over the smaller muscles at the back of the shoulder.',
  functionText:
    'The anterior deltoid raises the arm forward and overhead (flexion) and assists in turning the upper arm inward and drawing it across the body. It is a major contributor to pressing and reaching-forward actions and partners with the chest during push-ups and overhead presses.',
  screeningNotes:
    'Commonly short and overactive in people whose training or daily work is heavy on forward pressing and reaching. When it dominates, it helps hold the upper arm rolled forward, adding to a rounded-shoulder look. It is rarely judged weak in screening; the usual pattern is that it overworks relative to the back-of-shoulder and mid-back muscles. A client with a markedly forward-set shoulder may benefit from professional evaluation.',
  links: [
    {
      imbalanceKey: 'anterior_imbalanced_shoulders',
      role: 'tight',
      confidence: 'low',
      citation: 'Janda / Kendall 2005 (textbooks) — rounded-shoulder inference; no EMG study isolating anterior deltoid overactivity in this posture found.',
      rationale:
        'Press-dominant training tends to overbuild the anterior deltoid relative to the muscles that pull the shoulder back, so it sits short and overactive in anterior imbalanced shoulders. Because it crosses the front of the joint, a tight anterior deltoid helps hold the upper arm flexed and rolled inward, reinforcing the forward shoulder position. Easing its tone and rebalancing it against the back-of-shoulder muscles helps the joint re-center.',
    },
  ],
  reviewedBy: null,
  reviewedAt: null,
}
