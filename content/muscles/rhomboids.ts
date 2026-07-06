import type { MuscleContent } from './types'

export const rhomboids: MuscleContent = {
  slug: 'rhomboids',
  name: 'Rhomboids',
  region: 'shoulder_girdle',
  anatomySummary:
    'The rhomboids are a pair of flat, diamond-shaped muscles in the upper back that run from the spine out to the inner edge of the shoulder blade. There are two: the rhomboid minor up near the base of the neck and the larger rhomboid major just below it. Their fibers angle downward and outward from the spine to the shoulder blade, so when they pull, they draw the shoulder blade in toward the spine and slightly upward. They sit beneath the trapezius and work as the main anchors holding the shoulder blades back against the ribcage.',
  functionText:
    'The rhomboids pull the shoulder blades in toward the spine (retraction) and help tip the lower edge of the blade inward (downward rotation). They steady the shoulder blade against the ribcage so the arm has a stable base to work from, and they resist the forward drift of the shoulders during reaching and pulling tasks.',
  screeningNotes:
    'Commonly lengthened and underactive in people who sit hunched or train the front of the body far more than the back. When they cannot hold the shoulder blades back, the shoulders drift forward and the upper back rounds. In screening they are usually flagged as weak rather than short, and a client who struggles to draw the shoulder blades together may benefit from professional evaluation and targeted strengthening.',
  links: [
    {
      imbalanceKey: 'anterior_imbalanced_shoulders',
      role: 'weak',
      confidence: 'low',
      citation: 'Janda (textbook) — retractor-weakness inference; EMG studies in this space quantify trapezius and serratus, not rhomboids in isolation; no isolating study found.',
      rationale:
        'In anterior imbalanced shoulders the rhomboids are stretched long and underactive, so they lose the tug-of-war against tight chest muscles and the shoulder blades slide forward. Without their steady retraction, the shoulder blade drifts away from the spine and the shoulder rounds toward the front. Strengthening them may help restore a counterpull that holds the shoulder blades back and supports re-centering the shoulders over the ribcage.',
    },
    {
      imbalanceKey: 'posterior_imbalanced_shoulders',
      role: 'weak',
      confidence: 'low',
      scored: true,
      rationale: 'Rhomboids assist scapular retraction; the link is anatomically coherent though the resting-position association is less direct than for middle-trapezius.',
      citation: 'Kang 2016 (shoulder retractor EMG)',
    },
  ],
  reviewedBy: null,
  reviewedAt: null,
}
