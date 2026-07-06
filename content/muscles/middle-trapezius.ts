import type { MuscleContent } from './types'

export const middleTrapezius: MuscleContent = {
  slug: 'middle-trapezius',
  name: 'Middle Trapezius',
  region: 'head_neck',
  anatomySummary:
    'The middle trapezius is the central band of the large, diamond-shaped trapezius muscle, with fibers running roughly horizontally between the spine and the shoulder blade. It attaches along the spinous processes of the upper back vertebrae and travels outward to the bony ridge along the top of the shoulder blade. It sits in the area between the shoulder blades that many people think of as the upper back. Because its fibers pull straight inward, it is the muscle most directly responsible for drawing the shoulder blades back toward the spine and holding them there against the forward pull of the chest.',
  functionText:
    'The middle trapezius draws the shoulder blade inward toward the spine (retraction) and helps anchor it firmly against the rib cage, giving the arm a stable base to move from. It works with the rhomboids and lower trapezius to keep the shoulder blades set back and steady during reaching, pulling, and carrying.',
  screeningNotes:
    'Commonly lengthened and under-active in people whose shoulders round forward, since the chest muscles shorten and the mid-back is held in a stretched, switched-off position. When it fails to hold the shoulder blades back, the upper trapezius tends to take over and the rounded look persists. In screening it is far more often flagged as weak than tight; the ability to draw the shoulder blades back and hold them is the usual concern.',
  links: [
    {
      imbalanceKey: 'anterior_imbalanced_shoulders',
      role: 'weak',
      confidence: 'medium',
      citation: 'Bae 2023 (RCT, grouped scapular retractors) — middle-trapezius underactivity associated with protracted scapula; measured within a retractor group, not isolated.',
      rationale:
        'When the shoulders round and drift forward, the middle trapezius sits in a lengthened position and loses its ability to draw the shoulder blades back toward the spine. With this retractor switched off, the tight chest muscles win and the shoulders settle further forward, and any side-to-side difference in its activity can leave one shoulder more forward than the other. Strengthening it helps pull the shoulder blades back and level the shoulders.',
    },
    {
      imbalanceKey: 'posterior_imbalanced_shoulders',
      role: 'weak',
      confidence: 'medium',
      scored: true,
      rationale: 'Middle-trapezius under-activation is a modifiable contributor to a rounded-shoulder pattern; retraction strengthening improves resting scapular position.',
      citation: 'Alghadir 2023 Int J Environ Res Public Health (RCT); Castelein 2019 EMG',
    },
  ],
  reviewedBy: null,
  reviewedAt: null,
}
