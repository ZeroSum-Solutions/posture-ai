import type { MuscleContent } from './types'

export const gastrocnemiusSoleus: MuscleContent = {
  slug: 'gastrocnemius-soleus',
  name: 'Gastrocnemius & Soleus',
  region: 'knee_leg',
  anatomySummary:
    'The gastrocnemius and soleus form the calf at the back of the lower leg and share the Achilles tendon into the heel. The gastrocnemius is the larger, two-headed muscle that crosses both the knee and the ankle, starting just above the back of the knee on the thigh bone. The soleus lies underneath it and crosses only the ankle, beginning lower down on the back of the shin. Together they point the foot downward, and because the gastrocnemius spans the knee it also assists with knee bending. As a unit the calf pair is central to standing balance and to push-off in walking, running, and rising onto the toes.',
  functionText:
    'The calf pair plantarflexes the ankle — pointing the foot and pushing the body forward in every step and rise onto the toes — while the gastrocnemius also assists in bending the knee. Just as importantly, the soleus works almost continuously during quiet standing as a postural muscle, making tiny adjustments that keep the body from toppling forward over the feet.',
  screeningNotes:
    'The calf commonly reads as short and overactive in clients who stand with weight shifted forward or who keep the knees locked back, since it works overtime to balance the body over the feet. Tightness here can pull the knee and ankle into less optimal positions. It may benefit from professional evaluation when ankle mobility is limited or the heels lift early during a squat.',
  links: [
    {
      imbalanceKey: 'anterior_pelvic_shift',
      role: 'tight',
      rationale:
        'When the pelvis and body sway forward over the feet, the calf (gastrocnemius and soleus) fires constantly to keep the body from toppling, and over time it shortens. Prolonged standing sway, high heels, and a forward center of mass all load the calf this way. Releasing and lengthening it helps the body re-balance back over the midfoot rather than hanging forward at the ankles.',
    },
    {
      imbalanceKey: 'knee_extension_back_knee',
      role: 'tight',
      confidence: 'low',
      scored: false,
      exclusionReason:
        'Display-only: the calf to recurvatum link rests on stroke-population and direction-ambiguous evidence (Grade C), below the asymptomatic-population bar the hamstring link cleared, so it is kept educational rather than scored.',
      rationale:
        'In a back-knee (hyperextended) pattern the calf — especially the gastrocnemius, which crosses the knee — pulls on the back of the joint and helps hold it locked into full extension. High heels and a backward-shifted center of mass reinforce this backward pull. Lengthening the calf reduces the tension behind the knee and lets the joint rest in a softer, neutral position.',
    },
  ],
  reviewedBy: null,
  reviewedAt: null,
}
