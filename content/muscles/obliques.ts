import type { MuscleContent } from './types'

export const obliques: MuscleContent = {
  slug: 'obliques',
  name: 'Internal & External Obliques',
  region: 'trunk',
  anatomySummary:
    'The internal and external obliques are the angled abdominal muscles that form the sides of the waist, layered between the ribs and the pelvis. The external oblique is the outer layer, with fibers running downward and forward; the internal oblique lies just beneath it with fibers running the opposite way. Together they wrap the trunk like crossed straps, attaching to the lower ribs, the broad abdominal sheet at the midline, and the rim of the pelvis. This crisscross arrangement makes them well suited to twisting and side-bending the trunk and to controlling rotation between the ribcage and pelvis during everyday movement.',
  functionText:
    'The obliques bend the trunk sideways and rotate it, with each external oblique teaming up with the opposite internal oblique to turn the ribcage and pelvis relative to one another. They also compress the abdomen and help set the position of the ribcage over the pelvis. Working together on both sides, they assist trunk flexion and provide rotational stability during walking, lifting, and one-sided tasks.',
  screeningNotes:
    'In rotational asymmetry the obliques often work unevenly: shortened and overactive on one side, lengthened and underactive on the other. Clients with one-sided habits such as always crossing the same leg or loading one side in sport tend to show this pattern. In screening, the focus is the left-to-right balance of oblique tone and control, since a side difference rather than overall weakness usually drives a rotated trunk or pelvis.',
  links: [
    {
      imbalanceKey: 'pelvic_axial_rotation',
      role: 'tight',
      rationale:
        'On the rotation side, the side toward which the pelvis has turned, the obliques sit shortened and overactive, helping hold the trunk and pelvis in their rotated position. Because the obliques drive trunk rotation, sustained one-sided loading keeps these rotation-side fibers tight and pulls the ribcage and pelvis around toward that side. Releasing and lengthening the rotation-side obliques reduces the twisting pull and may benefit the return of the pelvis toward a square, forward-facing position.',
    },
    {
      imbalanceKey: 'pelvic_axial_rotation',
      role: 'weak',
      rationale:
        'On the side opposite the rotation, the obliques are held long and underactive and can no longer pull the trunk back toward center. Because un-rotating the pelvis depends on the obliques opposite the direction of turn firing to square it up, this lengthened side leaves the rotation unchecked and the trunk drifting toward the tight side. Rebuilding strength and timing in these opposite-side obliques may benefit the active unwinding of the rotation and the balance of left-to-right control.',
    },
  ],
  reviewedBy: null,
  reviewedAt: null,
}
