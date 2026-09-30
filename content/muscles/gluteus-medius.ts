import type { MuscleContent } from './types'

export const gluteusMedius: MuscleContent = {
  slug: 'gluteus-medius',
  name: 'Gluteus Medius',
  region: 'hip_pelvis',
  anatomySummary:
    'The gluteus medius is a fan-shaped muscle on the outer surface of the pelvis, lying partly under the gluteus maximus. It arises from the broad outer face of the ilium and narrows into a short tendon that attaches to the bony point at the top of the thigh bone (the greater trochanter). Its front and back fibers pull in slightly different directions, which lets it both lift the leg out to the side and fine-tune hip rotation. Positioned right over the side of the hip, it is the key frontal-plane stabilizer that keeps the pelvis level when you stand on one leg.',
  functionText:
    'The gluteus medius lifts the thigh out to the side (hip abduction) and, just as importantly, works in reverse: when you stand on one leg it holds the opposite side of the pelvis from dropping. Its forward and rear fibers also help rotate the hip. This makes it the main muscle keeping the pelvis level through every step of walking and running.',
  screeningNotes:
    'Commonly weak or poorly timed, which lets the pelvis drop or sway to one side during single-leg loading such as walking, stairs or running. An under-performing gluteus medius is closely tied to the knee falling inward and to side-to-side pelvic unleveling. It can also become short and overactive on the lower side when the pelvis is habitually tilted. Screening often reveals a pelvis that tips toward the unsupported side during a single-leg stance.',
  links: [
    {
      imbalanceKey: 'pelvic_obliquity',
      role: 'tight',
      confidence: 'low',
      side: 'lowered',
      citation: 'Janda / Kendall 2005 (textbooks) — inference for ipsilateral glute-med overactivity on the elevated side; no EMG study found for this specific pattern.',
      rationale:
        'On the side opposite the elevated hip, the gluteus medius tends to become short and overactive, bearing more standing load and holding the opposite side of the pelvis up, reinforcing the obliquity. Because it is the overactive partner here, it usually benefits from release and length work rather than added strengthening — the elevated-side medius is the one that needs waking up.',
    },
    {
      imbalanceKey: 'pelvic_obliquity',
      role: 'weak',
      confidence: 'high',
      side: 'elevated',
      citation: 'Semciw 2016 (J Electromyogr Kinesiol 30:98) — 13-study systematic review: reduced gluteus-medius EMG amplitude consistently associated with contralateral pelvic drop in running gait.',
      rationale:
        'On the elevated (higher) side of the pelvis, the gluteus medius sits in a lengthened, stretched position and loses the strength and timing needed to hold the pelvis level, so the obliquity is reinforced through the day. In screening it shows as a pelvis that cannot stay level in single-leg stance on this side, and it typically benefits from targeted strengthening and re-timing.',
    },
    {
      imbalanceKey: 'genu_varum_valgum_left',
      role: 'weak',
      confidence: 'high',
      citation: 'Rinaldi 2022 (J Exp Orthop, PMC9385941) — scoping review of 29 studies: gluteal strength deficits consistently linked to dynamic knee valgus across EMG and kinematics.',
      rationale:
        'On the left side, a weak gluteus medius lets the thigh bone drift inward and rotate in during weight-bearing, allowing the knee to fall toward the midline — the knee-drifting-inward (knock-knee) tendency — and weakening the frontal-plane control that should also keep a bow-knee in check. The medius is the main stabilizer sitting above the knee at the hip. Strengthening the left gluteus medius may help improve how the thigh tracks over the foot during standing and gait.',
    },
    {
      imbalanceKey: 'genu_varum_valgum_right',
      role: 'weak',
      confidence: 'high',
      citation: 'Rinaldi 2022 (J Exp Orthop, PMC9385941) — scoping review of 29 studies: gluteal strength deficits consistently linked to dynamic knee valgus across EMG and kinematics.',
      rationale:
        'On the right side, a weak gluteus medius lets the thigh bone drift inward and rotate in during weight-bearing, allowing the knee to fall toward the midline — the knee-drifting-inward (knock-knee) tendency — and weakening the frontal-plane control that should also keep a bow-knee in check. The medius is the main stabilizer sitting above the knee at the hip. Strengthening the right gluteus medius may help improve how the thigh tracks over the foot during standing and gait.',
    },
  ],
  reviewedBy: null,
  reviewedAt: null,
}
