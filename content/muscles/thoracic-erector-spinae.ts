import type { MuscleContent } from './types'

export const thoracicErectorSpinae: MuscleContent = {
  slug: 'thoracic-erector-spinae',
  name: 'Thoracic Erector Spinae',
  region: 'trunk',
  anatomySummary:
    'The thoracic erector spinae are the mid-back portion of the long erector spinae columns that run vertically on either side of the spine. In the thoracic region they span from the lower ribs and thoracolumbar area up toward the upper ribs and the transverse processes of the vertebrae, layered as the iliocostalis and longissimus tracts. They sit just beside the spinous processes, deep to the trapezius and rhomboids, and can be felt as the firm ridges either side of the backbone. Because they are postural muscles, they stay lightly active through the day to hold the trunk upright against gravity, working across the mid-back where the ribcage attaches.',
  functionText:
    'The thoracic erector spinae extend the mid-back, straightening the trunk and resisting the forward pull of gravity when sitting or standing. Acting on one side, they help the trunk side-bend and rotate. They also work to control the speed of bending forward, paying out length as the chest lowers and reversing it to bring the trunk back upright.',
  screeningNotes:
    'Their tone varies with posture: in clients who sit with the chest pressed up and the upper back arched, they can be short and overactive, feeling like firm bands beside the spine. In a slouched or forward-settled trunk, the same muscles more often lengthen and under-recruit. Screening should read which way the mid-back sits, since easing length and tone suits the arched presentation while endurance work suits the lengthened one.',
  links: [
    {
      imbalanceKey: 'trunk_lean',
      role: 'weak',
      confidence: 'low',
      citation:
        'Park 2015 (PMID 25463688) — thoracic erector selective recruitment decreased (inhibited) in slouched sitting; graded weak/inhibited for trunk lean, consistent with this reduced-activity finding.',
      rationale:
        'When the upper trunk settles out of a stacked position, the thoracic erector spinae tend to lengthen and under-recruit rather than hold the mid-back extended, so the chest drifts into flexion and the ribcage sits forward of the pelvis. Building endurance and control in these mid-back extensors helps re-stack the upper trunk over the spine. Because the merged trunk-lean pattern can also present as a backward-arched trunk where these muscles read short instead, screening should confirm which way the mid-back sits before loading.',
    },
    {
      imbalanceKey: 'forward_head_posture',
      role: 'weak',
      confidence: 'medium',
      scored: true,
      rationale:
        'Thoracic erector spinae shows selective under-activation in slouched thoracic posture; waking it up supports the extension that offsets a forward-head position.',
      citation: 'Lee 2014 J Phys Ther Sci PMID 25463688',
    },
  ],
  reviewedBy: null,
  reviewedAt: null,
}
