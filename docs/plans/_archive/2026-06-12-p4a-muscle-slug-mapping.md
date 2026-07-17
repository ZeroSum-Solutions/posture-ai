# P4a — Canonical muscle slugs + seed-string mapping (2026-06-12)

**Review requested (Devin):** this table is the contract for the whole muscle knowledge
base. Every free-text muscle string in the `imbalance_definitions` seed maps to exactly
one canonical slug; side/condition nuance moves into the link's `rationale_text`.
Content generation proceeds against these slugs — if a slug changes after review,
content files regenerate cheaply, so corrections are low-cost.

## Canonical muscles (28)

| Region | Slug | Display name |
|---|---|---|
| head_neck | `suboccipitals` | Suboccipitals |
| head_neck | `upper-trapezius` | Upper Trapezius |
| head_neck | `levator-scapulae` | Levator Scapulae |
| head_neck | `sternocleidomastoid` | Sternocleidomastoid |
| head_neck | `deep-cervical-flexors` | Deep Cervical Flexors |
| head_neck | `middle-trapezius` | Middle Trapezius |
| head_neck | `lower-trapezius` | Lower Trapezius |
| shoulder_girdle | `pectoralis-major` | Pectoralis Major |
| shoulder_girdle | `pectoralis-minor` | Pectoralis Minor |
| shoulder_girdle | `anterior-deltoid` | Anterior Deltoid |
| shoulder_girdle | `rhomboids` | Rhomboids |
| shoulder_girdle | `serratus-anterior` | Serratus Anterior |
| trunk | `thoracic-erector-spinae` | Thoracic Erector Spinae |
| trunk | `lumbar-erector-spinae` | Lumbar Erector Spinae |
| trunk | `latissimus-dorsi` | Latissimus Dorsi |
| trunk | `deep-abdominals` | Abdominal Wall (Rectus + Transversus) |
| trunk | `obliques` | Internal & External Obliques |
| trunk | `quadratus-lumborum` | Quadratus Lumborum |
| hip_pelvis | `iliopsoas` | Iliopsoas (Hip Flexors) |
| hip_pelvis | `gluteus-maximus` | Gluteus Maximus |
| hip_pelvis | `gluteus-medius` | Gluteus Medius |
| hip_pelvis | `hip-adductors` | Hip Adductors |
| hip_pelvis | `deep-hip-external-rotators` | Deep Hip External Rotators (Piriformis Group) |
| hip_pelvis | `tfl-it-band` | TFL & IT Band |
| knee_leg | `quadriceps` | Quadriceps (incl. VMO) |
| knee_leg | `hamstrings` | Hamstrings |
| knee_leg | `popliteus` | Popliteus |
| knee_leg | `gastrocnemius-soleus` | Gastrocnemius & Soleus |

## Seed-string → slug mapping (with nuance disposition)

| Seed string (verbatim) | Appears in (imbalance / role) | Slug(s) | Nuance moved to rationale |
|---|---|---|---|
| `suboccipitals` | forward_head_posture / tight | `suboccipitals` | — |
| `upper trapezius` | forward_head_posture, anterior_imbalanced_shoulders, posterior_imbalanced_shoulders / tight | `upper-trapezius` | — |
| `levator scapulae` | forward_head_posture, posterior_imbalanced_shoulders / tight | `levator-scapulae` | — |
| `sternocleidomastoid` | forward_head_posture / tight | `sternocleidomastoid` | — |
| `deep cervical flexors` | forward_head_posture / weak | `deep-cervical-flexors` | — |
| `lower trapezius` | forward_head_posture, anterior_imbalanced_shoulders, posterior_imbalanced_shoulders / weak | `lower-trapezius` | — |
| `middle trapezius` | anterior_imbalanced_shoulders / weak | `middle-trapezius` | — |
| `pectoralis major` | anterior_imbalanced_shoulders / tight | `pectoralis-major` | — |
| `pectoralis minor` | anterior_imbalanced_shoulders / tight | `pectoralis-minor` | — |
| `anterior deltoid` | anterior_imbalanced_shoulders / tight | `anterior-deltoid` | — |
| `rhomboids` | anterior_imbalanced_shoulders / weak | `rhomboids` | — |
| `serratus anterior` | anterior_imbalanced_shoulders / weak | `serratus-anterior` | — |
| `thoracic erector spinae` | t1_tilt_backward / tight | `thoracic-erector-spinae` | — |
| `latissimus dorsi` | t1_tilt_backward / tight | `latissimus-dorsi` | — |
| `deep thoracic flexors` | t1_tilt_backward / weak | `deep-abdominals` | absorbed per roadmap 4a; rationale notes the deep trunk-flexion role |
| `abdominals` | anterior_pelvic_shift / weak | `deep-abdominals` | — |
| `quadratus lumborum` | pelvic_obliquity / tight | `quadratus-lumborum` | — |
| `adductors (elevated side)` | pelvic_obliquity / tight | `hip-adductors` | "on the elevated pelvis side" |
| `opposite gluteus medius` | pelvic_obliquity / tight | `gluteus-medius` | "on the side opposite the elevation" (tight/overactive role) |
| `gluteus medius (elevated side)` | pelvic_obliquity / weak | `gluteus-medius` | "on the elevated side" |
| `hip flexors` | anterior_pelvic_shift / tight | `iliopsoas` | — |
| `lumbar erector spinae` | anterior_pelvic_shift / tight | `lumbar-erector-spinae` | — |
| `gastrocnemius` | anterior_pelvic_shift, knee_extension_back_knee / tight | `gastrocnemius-soleus` | — |
| `gluteals` | anterior_pelvic_shift, pelvic_axial_rotation / weak | `gluteus-maximus` | rationale notes the gluteal complex as a whole; medius covered by its own links |
| `hamstrings` | anterior_pelvic_shift / weak; knee_extension_back_knee / weak | `hamstrings` | — |
| `one-side hip rotators` | pelvic_axial_rotation / tight | `deep-hip-external-rotators` | "on the side of rotation" |
| `obliques` | pelvic_axial_rotation / tight | `obliques` | "rotation-side" |
| `opposite obliques` | pelvic_axial_rotation / weak | `obliques` | "opposite the rotation" — same muscle entity, side nuance in rationale |
| `tensor fasciae latae` | genu_varum_valgum_L/R / tight | `tfl-it-band` | — |
| `IT band` | genu_varum_valgum_L/R / tight | `tfl-it-band` | merged with TFL (single functional unit) |
| `lateral structures (varum) or adductors (valgum)` | genu_varum_valgum_L/R / tight | `tfl-it-band` **and** `hip-adductors` | conditional: lateral structures apply in varum, adductors in valgum — both links exist, each rationale states its condition |
| `gluteus medius` | genu_varum_valgum_L/R / weak | `gluteus-medius` | — |
| `vastus medialis (VMO)` | genu_varum_valgum_L/R / weak | `quadriceps` | "particularly the VMO" |
| `quadriceps` | knee_extension_back_knee / tight | `quadriceps` | — |
| `popliteus` | knee_extension_back_knee / weak | `popliteus` | — |

Notes:
- `genu_varum_valgum_left` and `genu_varum_valgum_right` share identical muscle links;
  left/right is a property of the finding, not the link.
- Expected `muscle_imbalance_links` row count after dedup: **~45** (tight + weak across
  10 imbalances, with the obliques/gluteus-medius dual-role rows counted separately
  because (muscle, imbalance, role) is the uniqueness key).
- Every slug above is referenced by at least one link; no orphan muscles.
