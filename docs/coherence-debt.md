# Coherence Debt Burn-Down

## What the gate enforces

`lib/program/coherence.test.ts` verifies that every exercise targets a muscle that is
coherent with its assigned finding: stretch exercises must hit a tight (scored) muscle,
strengthen/activation exercises must hit a weak (scored) muscle, and mobility exercises
must hit any scored muscle for the finding.

The `KNOWN_DEBT` list in that test file is an **enforced burn-down list**, not a waiver.
The gate remains at full strength for new content:

- A NEW incoherent pair (not in `KNOWN_DEBT`) fails the test — fix the content.
- A listed pair that becomes coherent fails the test — delete it from the list.

Each pair requires a per-category content or product decision before it can be removed.
Those decisions are tracked below. Do not add to `KNOWN_DEBT` without product-owner
sign-off.

---

## pelvic_axial_rotation — 12 pairs

**Root cause:** The `pelvic_axial_rotation` finding has zero scored muscles. The obliques
and deep-hip-external-rotators links were detached as unscoreable (transverse-plane metric
r=0.00–0.19 vs Vicon; no validated threshold). With an empty scored set, no exercise can
pass the gate for this finding regardless of what it targets. Seven of these exercises have
`pelvic_axial_rotation` as their only finding key (removing it would leave
`primaryDeviationKeys` empty, which the schema forbids).

**Pairs:**

| Exercise | Category | Primary target muscles | Also serves |
|---|---|---|---|
| band-lying-hip-internal-rotation | strengthen | deep-hip-external-rotators(strengthen) | only key |
| bird-dog | strengthen | gluteus-maximus(strengthen), deep-abdominals(strengthen) | trunk_lean (passes) |
| figure-four-stretch | stretch | deep-hip-external-rotators(stretch) | only key |
| half-kneeling-band-chop | strengthen | obliques(strengthen) | only key |
| open-book-stretch | mobility | thoracic-erector-spinae(stretch) | only key |
| pallof-press | strengthen | obliques(strengthen), deep-abdominals(strengthen) | only key |
| side-plank-knees | strengthen | obliques(strengthen), gluteus-medius(strengthen) | pelvic_obliquity (passes) |
| side-plank | strengthen | obliques(strengthen), gluteus-medius(strengthen) | pelvic_obliquity (passes) |
| single-leg-glute-bridge | strengthen | gluteus-maximus(strengthen), hamstrings(strengthen) | trunk_lean, knee_extension_back_knee (both pass) |
| standing-band-trunk-rotation | strengthen | obliques(strengthen) | only key |
| supine-crossover-stretch | stretch | hip-adductors(stretch) | pelvic_obliquity (passes) |
| tall-kneeling-anti-rotation-hold | activation | obliques(strengthen), deep-abdominals(strengthen) | only key |

**Resolution options:**
- (a) Re-add scored links for obliques and deep-hip-external-rotators to
  `pelvic_axial_rotation` — requires re-evaluating the "unscoreable" decision with
  clinical sign-off.
- (b) Remove `pelvic_axial_rotation` from multi-key exercises that already pass other
  findings (bird-dog, side-plank-knees, side-plank, single-leg-glute-bridge,
  supine-crossover-stretch).
- (c) For single-key exercises, either add a second valid finding key or accept that the
  exercise is functionally linked to the finding but the evidence bar cannot be met.

---

## posterior_imbalanced_shoulders — 5 pairs

**Root cause:** The scored set for `posterior_imbalanced_shoulders` is:
tight={upper-trapezius, levator-scapulae}, weak={lower-trapezius}. These exercises target
middle-trapezius and rhomboids (scapular retractors), which are not in the finding's
content-defined muscle set. The gap is a grading omission — retractor weakness is
clinically associated with posterior shoulder imbalance but was not assigned a scored link
during Task-2 grading.

**Pairs:**

| Exercise | Category | Primary target muscles | Also serves |
|---|---|---|---|
| band-rear-delt-row | strengthen | middle-trapezius(strengthen), rhomboids(strengthen) | only key |
| band-reverse-fly | strengthen | middle-trapezius(strengthen), rhomboids(strengthen) | only key |
| prone-t-raise | strengthen | middle-trapezius(strengthen), rhomboids(strengthen) | anterior_imbalanced_shoulders (passes) |
| prone-w-raise | strengthen | middle-trapezius(strengthen), rhomboids(strengthen) | only key |
| rear-deltoid-stretch | stretch | middle-trapezius(stretch), rhomboids(stretch) | only key |

**Resolution options:**
- (a) Add middle-trapezius and rhomboids as weak muscles in `posterior_imbalanced_shoulders`
  content — requires evidence review (Task-2 grading gap).
- (b) Remove `posterior_imbalanced_shoulders` from prone-t-raise only (safe; it already
  serves anterior_imbalanced_shoulders). The other four need new finding keys or option (a).

---

## knee_extension_back_knee — 6 pairs

**Root cause:** The scored set for `knee_extension_back_knee` is: tight={} (empty),
weak={hamstrings}. Gastrocnemius-soleus, quadriceps, and popliteus ARE linked to this
finding in content but are marked `scored: false`, so the gate excludes them. Most of these
exercises directly target those unscored muscles.

**Pairs:**

| Exercise | Category | Primary target muscles | Notes |
|---|---|---|---|
| bent-knee-calf-stretch | stretch | gastrocnemius-soleus(stretch) | Calf linked tight, scored:false. Also serves trunk_lean (passes). |
| seated-hamstring-stretch | stretch | hamstrings(stretch) | Hamstrings is weak (not tight); stretching a weak muscle. Only key. |
| seated-tibial-rotation | activation | popliteus(strengthen) | Popliteus linked weak, scored:false. Only key. |
| standing-calf-raise | strengthen | gastrocnemius-soleus(strengthen) | Strengthens a tight (scored:false) muscle. Only key. |
| standing-quad-stretch | stretch | quadriceps(stretch) | Quadriceps linked tight, scored:false. Only key. |
| wall-calf-stretch | stretch | gastrocnemius-soleus(stretch) | Calf linked tight, scored:false. Also serves trunk_lean (passes). |

**Resolution options:**
- (a) Upgrade gastrocnemius-soleus, quadriceps, and popliteus to `scored: true` for
  `knee_extension_back_knee` if the evidence bar can be met (Grade C is likely achievable
  for gastrocnemius-soleus and quadriceps).
- (b) For bent-knee-calf-stretch and wall-calf-stretch, remove `knee_extension_back_knee`
  since both already serve trunk_lean; they remain in the program via that key.
- (c) For seated-hamstring-stretch: consider whether the intent is to stretch or strengthen;
  if the exercise is correctly a stretch, the finding key may be wrong.

---

## pelvic_obliquity — 3 pairs

**Root cause:** The scored set for `pelvic_obliquity` is:
tight={quadratus-lumborum, hip-adductors, gluteus-medius (as tight)},
weak={gluteus-medius (as weak)}. None of these exercises target a muscle in that set.
The exercises work gluteus-maximus, hamstrings, and hip-flexors — muscles plausibly
relevant to pelvic stability but not content-linked to this finding.

**Pairs:**

| Exercise | Category | Primary target muscles | Also serves |
|---|---|---|---|
| glute-bridge-march | strengthen | gluteus-maximus(strengthen), deep-abdominals(strengthen) | trunk_lean (passes) |
| kneeling-hip-flexor-stretch | stretch | iliopsoas(stretch), rectus-femoris(stretch), quadriceps(stretch) | trunk_lean (passes) |
| single-leg-rdl | strengthen | hamstrings(strengthen), gluteus-maximus(strengthen) | trunk_lean, knee_extension_back_knee (both pass) |

**Resolution options:**
- (a) Add content links for gluteus-maximus, iliopsoas, and rectus-femoris to
  `pelvic_obliquity` — requires evidence review.
- (b) Remove `pelvic_obliquity` from all three exercises (safe: each already serves other
  passing keys — trunk_lean, and for single-leg-rdl also knee_extension_back_knee).

---

## forward_head_posture — 2 pairs

**Root cause:** The scored set for `forward_head_posture` is:
tight={levator-scapulae, upper-trapezius, suboccipitals, sternocleidomastoid},
weak={lower-trapezius, deep-cervical-flexors}. Neither exercise targets those muscles.
The connection is mechanistic (thoracic mobility affects head position) but is not captured
in content muscle links.

**Pairs:**

| Exercise | Category | Primary target muscles | Also serves |
|---|---|---|---|
| cat-cow | mobility | thoracic-erector-spinae(stretch), lumbar-erector-spinae(stretch) | trunk_lean (passes) |
| thoracic-extension | mobility | pectoralis-major(stretch), pectoralis-minor(stretch) | only key |

**Resolution options:**
- (a) Add thoracic-ES or pec-minor to `forward_head_posture` as tight links — requires
  evidence review.
- (b) Remove `forward_head_posture` from cat-cow (safe; it already serves trunk_lean).
- (c) For thoracic-extension, add a second finding key where pec-major/minor are scored
  tight (e.g. `anterior_imbalanced_shoulders`), then remove `forward_head_posture`.

---

## genu_varum_valgum — 2 pairs

**Root cause:** The scored set for `genu_varum_valgum_left` and `genu_varum_valgum_right`
is: tight={hip-adductors, tfl-it-band}, weak={gluteus-medius, quadriceps}.
Wall-ankle-dorsiflexion-rock targets gastrocnemius-soleus, which is not in this scored set.
Ankle dorsiflexion restriction is clinically linked to knee alignment, but that link is not
captured in content. Removing both keys would leave `primaryDeviationKeys` empty (schema
violation).

**Pairs:**

| Exercise | Category | Primary target muscles | Notes |
|---|---|---|---|
| wall-ankle-dorsiflexion-rock | mobility | gastrocnemius-soleus(stretch) | Both genu keys are the only keys for this exercise. |

**Resolution options:**
- (a) Add gastrocnemius-soleus as a tight link to `genu_varum_valgum_left` and
  `genu_varum_valgum_right` in content — requires evidence review.
- (b) Add a second valid finding key for this exercise (e.g. `knee_extension_back_knee`,
  where gastrocnemius-soleus IS linked though currently scored:false), then remove the genu
  keys — but this also requires resolving the scored:false gap first.

---

## Role-contradiction latent flags (muscle-role, not exercise×finding)

These are separate from the exercise×finding pairs above: they are muscle links whose CODED
role contradicts the cited literature. The gate does not catch them (a link is coherent with
whatever role it is coded), so they are tracked here for the same deferred clinical pass.

| Muscle | Finding | Coded role | Evidence | scored | Status |
|---|---|---|---|---|---|
| thoracic-erector-spinae | trunk_lean | weak | low (Park 2015 — inhibited in slouched sitting) | true | **RESOLVED** — Task 6 Option B flipped tight→weak; content + DB prose synced. |
| hamstrings | trunk_lean | weak | low | true | **OPEN** — deliberate deferral (2026-07-05). |

**hamstrings / trunk_lean (weak) — deferred by decision, NOT resolved:**
- The citation itself records the contradiction: no study supports hamstring *weakness* in
  sagittal trunk lean; lower-crossed literature describes hamstrings as short/overactive. Role
  flagged for review during Task 2, roles frozen there.
- Left AS-IS by explicit product-owner decision: the link is `scored: true`, so it drives the
  2D/3D map and the ranker, but it is honestly graded `low` → it renders in the possible-
  involvement tier (gray, "Possible / textbook-based" badge, 0.4 weight), which de-emphasises
  it. Flipping the role weak→tight would break the coherence of the hamstring-strengthening
  exercises currently mapped to trunk_lean; marking it `scored: false` would create NEW
  exercise×finding debt (those strengthen exercises would lose their only weak justification).
  Neither is a clean unilateral fix — it needs the clinical call.
- **Resolution options:** (a) confirm hamstrings are genuinely weak/lengthened in the merged
  trunk-lean pattern and rewrite the citation to support it; (b) recode the role to tight and
  re-home the hamstring-strengthening exercises onto a finding where hamstring weakness is
  supported; (c) mark `scored: false` and accept/relocate the dependent exercises. Requires
  product-owner sign-off, same as the pairs above.
