import type { MuscleContent } from './types'

export const levatorScapulae: MuscleContent = {
  slug: 'levator-scapulae',
  name: 'Levator Scapulae',
  region: 'head_neck',
  anatomySummary:
    'The levator scapulae is a strap-like muscle running along the side and back of the neck. It begins on the bony side projections of the top four neck vertebrae and travels downward to attach at the upper inner corner of the shoulder blade. For much of its length it sits underneath the upper trapezius, so it is hard to feel directly, though its lower attachment at the inner corner of the shoulder blade is a common site of muscular tension. As its name suggests, it is built to lift the shoulder blade, and it also has a strong influence on the side of the neck.',
  functionText:
    'The levator scapulae lifts the shoulder blade and tips its lower edge inward, and it helps side-bend and rotate the neck toward the same side. When the shoulder blade is anchored, it assists in supporting and steadying the neck. It works alongside the upper trapezius to raise and stabilize the shoulder during everyday carrying and reaching.',
  screeningNotes:
    'Commonly short and overactive, especially in people who hold the head forward, hike one shoulder, or carry one-sided loads. Because it bridges the neck and the shoulder blade, elevated resting tone here often shows up as restricted range at the upper inner corner of the shoulder blade and along the side of the neck. In screening it is far more often flagged as tight than weak; resting length and tone are the typical concern.',
  links: [
    {
      imbalanceKey: 'forward_head_posture',
      role: 'tight',
      confidence: 'low',
      citation: 'Janda 1988 / Kendall 2005 (textbooks) — upper-crossed classification places levator scapulae as overactive in FHP; no FHP-specific EMG or kinematic study found.',
      rationale:
        'With the head held forward of the shoulders, the levator scapulae stays loaded as it helps support the neck and steady the head. Its attachment on the upper neck vertebrae means a forward-head position keeps it under sustained tension, shortening it over time and adding to the stiffness felt along the side and base of the neck. Lengthening it supports a more centered head position over the spine.',
    },
    {
      imbalanceKey: 'posterior_imbalanced_shoulders',
      role: 'tight',
      confidence: 'medium',
      citation: 'Mahmoud 2023 (systematic review) — levator/upper-crossed overactivity; applied to the posterior scapular pattern by extrapolation, not a dedicated study.',
      rationale:
        'Posterior imbalanced shoulders involve a shoulder that sits hiked or elevated. The levator scapulae is a direct elevator of the shoulder blade, so a chronically raised shoulder keeps these fibers shortened and overactive on the affected side. Because it also tips the inner corner of the shoulder blade, ongoing tension can hold the blade in a less efficient resting position; easing it helps the shoulder settle toward a level height.',
    },
  ],
  reviewedBy: null,
  reviewedAt: null,
}
