import type { MuscleContent } from './types'

export const upperTrapezius: MuscleContent = {
  slug: 'upper-trapezius',
  name: 'Upper Trapezius',
  region: 'head_neck',
  anatomySummary:
    'The upper trapezius is the top section of the large, diamond-shaped trapezius muscle that spans the back of the neck and upper back. Its upper fibers run from the base of the skull and the back of the neck down and outward to the collarbone and the tip of the shoulder. This is the visible slope you can see and feel between the neck and the point of the shoulder. Because it attaches to both the head and the shoulder-blade region, it ties neck position and shoulder position together, and it tends to carry a lot of everyday tension from holding the head up, shrugging, and steadying loads carried in the hands or on the shoulders.',
  functionText:
    'The upper trapezius lifts the shoulder blade (the shrugging motion), helps turn it upward when the arm reaches overhead, and assists in extending and side-bending the neck. Paired with the lower trapezius, it forms a force couple that rotates the shoulder blade smoothly during arm elevation. It also helps support the weight of the head and arms throughout the day.',
  screeningNotes:
    'Commonly short and overactive. It tends to stay switched on in people who sit at desks, carry bags on one shoulder, or hold tension through the neck and shoulders, often producing a raised, hunched look. Because it is so easy to over-recruit, it frequently dominates movements that the deeper and lower scapular muscles should share. In screening it is far more often flagged as tight than weak; resting length and tone are the usual concern.',
  links: [
    {
      imbalanceKey: 'forward_head_posture',
      role: 'tight',
      confidence: 'medium',
      rationale:
        'As the head drifts forward of the shoulders, the upper trapezius works harder to hold the heavier load of the head against gravity and to keep the eyes level. Sustained low-level activity in this position shortens the upper fibers and raises their resting tone, which adds to the pull on the neck and reinforces the forward-head pattern. Easing this tension supports re-centering the head over the spine.',
    },
    {
      imbalanceKey: 'anterior_imbalanced_shoulders',
      role: 'tight',
      confidence: 'high',
      rationale:
        'When the shoulders round and drift forward, the upper trapezius often over-works to stabilize and elevate the shoulder blade in place of the weaker mid- and lower-trapezius fibers. This over-reliance keeps the upper fibers short and tense, and when one side is loaded or leaned on more than the other it can hold that shoulder higher and further forward. Releasing it lets the lower scapular muscles re-engage.',
    },
    {
      imbalanceKey: 'posterior_imbalanced_shoulders',
      role: 'tight',
      rationale:
        'Posterior imbalanced shoulders involve a shoulder that sits elevated or hiked upward. The upper trapezius is a primary elevator of the shoulder blade, so chronic hiking, one-sided carrying, or guarding keeps these fibers shortened and overactive on the affected side. Sustained elevation is exactly what the upper trapezius produces, so reducing its tone helps the shoulder settle back toward a level resting height.',
    },
  ],
  reviewedBy: null,
  reviewedAt: null,
}
