import type { MuscleContent } from './types'

export const lumbarErectorSpinae: MuscleContent = {
  slug: 'lumbar-erector-spinae',
  name: 'Lumbar Erector Spinae',
  region: 'trunk',
  anatomySummary:
    'The lumbar erector spinae are the lower portion of the erector spinae columns, running vertically through the low back on either side of the lumbar spine. They arise from the broad thoracolumbar sheet and the back of the pelvis and sacrum, then travel upward to attach along the lumbar vertebrae and lower ribs as part of the iliocostalis and longissimus tracts. They form the thick muscular ridges that can be felt either side of the spine just above the waistband. As powerful postural muscles, they stay active to support the natural inward curve of the low back and to keep the trunk from collapsing forward.',
  functionText:
    'The lumbar erector spinae extend the low back, deepening the lumbar curve and lifting the trunk upright from a bent position. They also help the trunk side-bend toward the working side. A large part of their job is steady postural control: holding the spine erect during standing and sitting, and slowing the descent when bending forward by lengthening under load.',
  screeningNotes:
    'Commonly short and overactive in clients who stand in a swayed posture or carry load in front of the body, where the low back stays arched to keep the chest up. Held in this shortened position, these muscles can feel tight and ropey beside the lumbar spine. In screening they tend to read as overactive paired with under-supporting deep abdominals, so length here is the usual focus.',
  links: [
    {
      imbalanceKey: 'trunk_lean',
      role: 'tight',
      confidence: 'high',
      citation: 'Ghaffari 2026 (PLOS One, PMC12959714) — RCT: erector-spinae EMG elevated at baseline in lower-crossed women; overactivity confirmed alongside anterior pelvic tilt.',
      rationale:
        'When the pelvis drifts forward of the ankles in an anterior pelvic shift, the upper trunk counter-leans backward to stay balanced, and the lumbar erector spinae shorten to hold that arched low-back position. Their overactivity deepens the lumbar curve and keeps the trunk tipped back, working opposite the deep abdominals that would otherwise level the pelvis. Restoring their length, while rebuilding abdominal support, may benefit the way the hips return under the ribcage and shoulders.',
    },
  ],
  reviewedBy: null,
  reviewedAt: null,
}
