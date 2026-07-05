import type { MuscleContent } from './types'

export const lowerTrapezius: MuscleContent = {
  slug: 'lower-trapezius',
  name: 'Lower Trapezius',
  region: 'head_neck',
  anatomySummary:
    'The lower trapezius is the bottom section of the large, diamond-shaped trapezius muscle. Its fibers begin on the spinous processes of the lower and mid back vertebrae and angle upward and outward to attach near the inner end of the bony ridge on the shoulder blade. This places it across the lower part of the area between and just below the shoulder blades. Because its fibers pull downward and inward, it draws the shoulder blade down toward the spine, and it is a key partner to the upper trapezius in rotating the shoulder blade smoothly when the arm lifts overhead.',
  functionText:
    'The lower trapezius pulls the shoulder blade down and in toward the spine and helps rotate it upward as the arm raises overhead. Paired with the upper trapezius, it forms a force couple that turns the shoulder blade smoothly during arm elevation, and it helps anchor the blade down so the shoulder does not hike up during reaching and lifting.',
  screeningNotes:
    'Commonly lengthened and under-active. When it fails to anchor the shoulder blade down, the upper trapezius and levator scapulae take over, and the shoulders tend to ride up and round forward. This under-use shows up across forward-head, rounded-shoulder, and hiked-shoulder patterns alike. In screening it is far more often flagged as weak than tight; the ability to draw the shoulder blade down and hold it is the usual concern.',
  links: [
    {
      imbalanceKey: 'forward_head_posture',
      role: 'weak',
      confidence: 'medium',
      citation: 'Kim 2015 (J Phys Ther Sci, PMID 26180310) — EMG in adults with FHP and rounded shoulders showed no significant lower-trapezius change across head positions; association is upper-crossed inference.',
      rationale:
        'The lower trapezius helps anchor the shoulder blades down and supports an upright upper back that lets the head stack over the shoulders. When it is under-active, the shoulder blades ride up, the upper back rounds, and the head is carried further forward. Because it counterbalances the overworked upper trapezius, restoring its strength supports a more upright posture and a centered head position.',
    },
    {
      imbalanceKey: 'anterior_imbalanced_shoulders',
      role: 'weak',
      confidence: 'high',
      citation: 'Gu 2024 (EMG study) + Cools 2007 (Am J Sports Med) — reduced lower-trapezius activation consistently associated with scapular dyskinesis / rounded-shoulder posture.',
      rationale:
        'When the shoulders round forward, the lower trapezius is held long and switched off, so it cannot draw the shoulder blades down and back. The upper trapezius and chest muscles then dominate, pulling the shoulders up and forward, and uneven activity side to side can leave one shoulder more forward than the other. Strengthening the lower trapezius helps set the shoulder blades down and back and level the shoulders.',
    },
    {
      imbalanceKey: 'posterior_imbalanced_shoulders',
      role: 'weak',
      confidence: 'high',
      citation: 'Gu 2024 (EMG) + Cools 2007 (Am J Sports Med) — reduced lower-trapezius activation in scapular dyskinesis; carried to this pattern.',
      rationale:
        'Posterior imbalanced shoulders involve a shoulder that sits hiked and elevated. The lower trapezius is the main muscle that pulls the shoulder blade downward, so when it is weak the elevators (upper trapezius and levator scapulae) go unopposed and the shoulder rides high. Strengthening the lower fibers may help restore the downward pull that supports a more level resting shoulder height.',
    },
  ],
  reviewedBy: null,
  reviewedAt: null,
}
