import type { MuscleContent } from './types'

// Region is hip_pelvis rather than knee_leg: the rectus femoris is anatomically
// a quadriceps head, but the only inference we model for it is its biarticular
// hip-flexor role driving anterior pelvic tilt, so it groups with the iliopsoas.
export const rectusFemoris: MuscleContent = {
  slug: 'rectus-femoris',
  name: 'Rectus Femoris',
  region: 'hip_pelvis',
  anatomySummary:
    'The rectus femoris is the only one of the four quadriceps muscles that crosses both the hip and the knee. It runs straight down the middle of the front thigh, beginning on the front of the pelvis at the bony point just below and in front of the hip (the anterior inferior iliac spine) and joining the shared quadriceps tendon that wraps the kneecap and attaches to the top of the shinbone. Because it spans two joints, it both lifts the thigh at the hip and straightens the knee, and its length is shared between those movements — bending the knee while the hip is extended puts it on full stretch. This two-joint arrangement makes the rectus femoris a direct mechanical link between the tilt of the pelvis and the front of the thigh.',
  functionText:
    'The rectus femoris flexes the hip, drawing the thigh up toward the trunk, and extends the knee, contributing to kicking, stair climbing, and the forward swing of the leg in walking. Because it anchors onto the front of the pelvis, a short rectus femoris can add to a forward pelvic tilt as one of several hip flexors, deepening the low-back arch. It shares hip-flexion duty with the iliopsoas and knee-extension duty with the three deeper quadriceps heads, sitting at the crossover of the two.',
  screeningNotes:
    'The rectus femoris commonly reads as short and overactive in clients who sit for long stretches or who stand with the pelvis tipped forward, since its hip attachment keeps it loaded in those positions. When shortened it can add to a forward pelvic tilt as part of the hip-flexor group, working alongside the iliopsoas rather than on its own. It may benefit from professional evaluation when the front of the hip feels persistently tight or the lower back stays arched; a kneeling or standing thigh stretch that combines hip extension with knee bending lengthens it directly.',
  links: [
    {
      imbalanceKey: 'trunk_lean',
      role: 'tight',
      confidence: 'medium',
      rationale:
        'As a two-joint muscle anchored to the front of the pelvis, a short rectus femoris can contribute, as one of the hip flexors, to a forward pelvic tilt and to the hips carrying ahead of the ankles in an anterior pelvic shift. The evidence frames it as part of the hip-flexor group rather than in isolation — easing hip-flexor tightness measurably reduces the forward tilt, but the effect is modest and cannot be pinned to the rectus femoris alone. It is therefore graded medium-confidence and addressed together with the iliopsoas.',
    },
  ],
  reviewedBy: null,
  reviewedAt: null,
}
