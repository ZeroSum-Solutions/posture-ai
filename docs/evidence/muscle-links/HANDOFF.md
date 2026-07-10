# Task 2 grading handoff — final adjudicated verdicts (42 links)

Transcribe `confidence` + `citation` onto each link in `content/muscles/<slug>.ts`.
Rules: keep every existing `rationale`, `role`, `scored`, `exclusionReason` byte-for-byte;
only ADD `confidence` (if absent) and `citation`. The `citation` field is
`screeningText(8, 240).optional()` — numeric (min,max) wrapper, already merged (main 5d44be2).
Link enumeration in the completeness test uses `ALL_MUSCLES.flatMap(m => m.links)` (no `ALL_MUSCLE_LINKS` exists).

Each citation must stay ≤240 chars and pass screening vocab (no diagnos*/treat*/cure*/patient*/prescri*).
The per-key evidence files (`.superpowers/sdd/lit-p2/<key>.md`) hold the full notes; the lines below are the source of truth to write.

Final distribution: **16 high / 15 medium / 11 low** = 42.

---

## forward_head_posture (file per muscle)
- deep-cervical-flexors [weak]: confidence=high | citation="Khan 2020 (J Chiropr Med, PMC7835487) — EMG: adults with FHP had reduced deep cervical flexor endurance and raised superficial activation vs normal-posture controls."
- levator-scapulae [tight]: confidence=low | citation="Janda 1988 / Kendall 2005 (textbooks) — upper-crossed classification places levator scapulae as overactive in FHP; no FHP-specific EMG or kinematic study found."
- lower-trapezius [weak]: confidence=medium | citation="Kim 2015 (J Phys Ther Sci, PMID 26180310) — EMG in adults with FHP and rounded shoulders showed no significant lower-trapezius change across head positions; association is upper-crossed inference."
- sternocleidomastoid [tight]: confidence=high | citation="Kim 2015 (J Phys Ther Sci, PMID 26696712) — EMG showed greater SCM activation during neck rotation in adults with FHP vs controls."
- suboccipitals [tight]: confidence=medium | citation="Lin 2022 (Clin Anat, PMID 35038194) — cadaveric study showed suboccipital extensors shortened in FHP; surface EMG is impractical for this group."
- upper-trapezius [tight]: confidence=high | citation="Khan 2020 (J Chiropr Med, PMC7835487) — EMG: elevated upper-trapezius activity in adults with FHP vs normal posture, at rest and during arm activity."

## anterior_imbalanced_shoulders
- anterior-deltoid [tight]: confidence=low | citation="Janda / Kendall 2005 (textbooks) — rounded-shoulder inference; no EMG study isolating anterior deltoid overactivity in this posture found."
- lower-trapezius [weak]: confidence=high | citation="Gu 2024 (EMG study) + Cools 2007 (Am J Sports Med) — reduced lower-trapezius activation consistently associated with scapular dyskinesis / rounded-shoulder posture."
- middle-trapezius [weak]: confidence=medium | citation="Bae 2023 (RCT, grouped scapular retractors) — middle-trapezius underactivity associated with protracted scapula; measured within a retractor group, not isolated."
- pectoralis-major [tight]: confidence=medium | citation="Lewis 2010 (manual-therapy study) — pectoralis-major length associated with rounded-shoulder posture; indirect (length/manual measure, not dynamic EMG)."
- pectoralis-minor [tight]: confidence=high | citation="Borstad & Ludewig 2005 (JOSPT) — shortened pectoralis minor associated with increased scapular anterior tilt and internal rotation in adults."
- rhomboids [weak]: confidence=low | citation="Janda (textbook) — retractor-weakness inference; EMG studies in this space quantify trapezius and serratus, not rhomboids in isolation; no isolating study found."
- serratus-anterior [weak]: confidence=high | citation="Pirauá 2014 (EMG) + PMC11145323 (motor-unit study) — reduced serratus-anterior activation associated with scapular dyskinesis / winging."
- upper-trapezius [tight]: confidence=high | citation="Mahmoud 2023 (systematic review) — upper-trapezius overactivity a consistent feature of upper-crossed / rounded-shoulder posture across EMG studies."

## posterior_imbalanced_shoulders (extrapolation caveat: this exact retracted/depressed pattern is unstudied as a distinct syndrome; grades carried from upper-crossed/dyskinesis research)
- levator-scapulae [tight]: confidence=medium | citation="Mahmoud 2023 (systematic review) — levator/upper-crossed overactivity; applied to the posterior scapular pattern by extrapolation, not a dedicated study."
- lower-trapezius [weak]: confidence=high | citation="Gu 2024 (EMG) + Cools 2007 (Am J Sports Med) — reduced lower-trapezius activation in scapular dyskinesis; carried to this pattern."
- upper-trapezius [tight]: confidence=high | citation="Mahmoud 2023 (systematic review) — upper-trapezius overactivity consistent across scapular-posture EMG studies."

## genu_varum_valgum_left AND genu_varum_valgum_right (IDENTICAL — write the same grade+citation to BOTH the left and right link entries in each muscle file; 4 grades → 8 link instances)
- gluteus-medius [weak]: confidence=high | citation="Rinaldi 2022 (J Exp Orthop, PMC9385941) — scoping review of 29 studies: gluteal strength deficits consistently linked to dynamic knee valgus across EMG and kinematics."
- hip-adductors [tight]: confidence=low | citation="Hollman 2009 (J Sport Rehabil, PMID 19321910) — hip-adduction angle correlated with knee valgus in step-down; no study directly tested adductor tightness as a cause of frontal-plane deviation."
- quadriceps [weak]: confidence=medium | citation="Park 2014 (J Phys Ther Sci, PMID 25435677) — genu varum showed higher VMO vs VL EMG, valgum higher VL/RF; altered patterns a partial contributor to frontal-plane mechanics."
- tfl-it-band [tight]: confidence=medium | citation="Stickley 2018 (J Athl Train, PMC5842903) — dynamic varus measures associated with IT-band syndrome onset; TFL-ITB lateral tension mechanistically plausible, not directly tested kinematically."

## knee_extension_back_knee (3 links are scored:false display-only — keep that flag; grade anyway)
- gastrocnemius-soleus [tight] (display-only): confidence=medium | citation="Svehlik 2010 (J Pediatr Orthop B, PMID 20442674) — high soleus EMG in single stance linked kinematically to recurvatum timing; calf-lengthening reduced hyperextension (PMID 24029800)."
- hamstrings [weak] (scored): confidence=medium | citation="Zwick 2010 (J Pediatr Orthop B, PMID 20308923) — 35 children with spastic cerebral palsy (47 limbs) vs 12 controls: hamstrings abnormally long at initial contact; surface EMG showed prolonged stance and early swing activity, not reduced."
- popliteus [weak] (display-only): confidence=low | citation="Mann & Hagy 1977 (JBJS Am) — EMG showed popliteus active during knee hyperextension in adults; no study directly links popliteus weakness to recurvatum development."
- quadriceps [tight] (display-only): confidence=low | citation="Kendall 2005 (Muscles: Testing and Function, 5th ed.) — textbook inference; anterior quadriceps dominance implicated in recurvatum; no EMG/kinematic confirmation in asymptomatic adults found."

## pelvic_obliquity (gluteus-medius appears twice, opposite roles — grade each entry)
- gluteus-medius [tight]: confidence=low | citation="Janda / Kendall 2005 (textbooks) — inference for ipsilateral glute-med overactivity on the elevated side; no EMG study found for this specific pattern."
- gluteus-medius [weak]: confidence=high | citation="Semciw 2016 (J Electromyogr Kinesiol 30:98) — 13-study systematic review: reduced gluteus-medius EMG amplitude consistently associated with contralateral pelvic drop in running gait."
- hip-adductors [tight]: confidence=medium | citation="Yen 2021 (Spine Deform 9:1259) — review: hip-adductor contracture drives infrapelvic obliquity; mechanistic evidence indirect, no healthy-adult kinematic study found."
- quadratus-lumborum [tight]: confidence=high | citation="Oshikawa 2020 (Am J Phys Med Rehabil, PMID 32541348) — fine-wire intramuscular EMG, n=12 healthy men: anterior QL activity correlated with ipsilateral lateral pelvic elevation."

## trunk_lean
- deep-abdominals [weak]: confidence=medium | citation="Waongenngarm 2015 (PMID 27014491) — internal-oblique/TrA EMG fatigue occurred in slumped sitting in office workers but not upright; deep-core underactivity linked to forward-flexed trunk."
- gastrocnemius-soleus [tight]: confidence=medium | citation="Watanabe 2019 (Gait Posture, PMID 30497039) — voluntary forward lean controlled by low-frequency neural input to medial gastrocnemius; tight-calf-to-lean remains mechanistic inference."
- gluteus-maximus [weak]: confidence=high | citation="Ghaffari 2026 (PLOS One, PMC12959714) — 8-week RCT in women with lower-crossed pattern: gluteus-maximus EMG improved; gluteal inhibition confirmed alongside anterior pelvic tilt."
- hamstrings [weak]: confidence=low | citation="Janda lower-crossed / Kendall 2005 — no study supports hamstring WEAKNESS in sagittal trunk lean; lower-crossed literature describes hamstrings as short/overactive. Role flagged for review."
- iliopsoas [tight]: confidence=high | citation="Sci Rep 2025 (PMC11923245) — tight-iliopsoas group showed altered gluteus-maximus, biceps-femoris and multifidus EMG vs normal hip-flexor group during landing (n=28)."
- latissimus-dorsi [tight]: confidence=low | citation="Lee 2016 (Ann Rehabil Med, PMC4855127) — lat activation changed with slouched sitting; no study links lat tightness specifically to sagittal trunk lean; Kendall 2005 inference."
- lumbar-erector-spinae [tight]: confidence=high | citation="Ghaffari 2026 (PLOS One, PMC12959714) — RCT: erector-spinae EMG elevated at baseline in lower-crossed women; overactivity confirmed alongside anterior pelvic tilt."
- rectus-femoris [tight]: confidence=medium | citation="Takaki 2016 (Phys Ther Res, PMID 28289581) — rectus femoris among the most active muscles during anterior pelvic tilting; tight RF tilts the pelvis, contributing to compensatory trunk lean."
- thoracic-erector-spinae [tight]: confidence=low | citation="Park 2015 (PMID 25463688) — thoracic erector selective recruitment DECREASED (inhibited) in slouched posture, contradicting an overactive 'tight' label; role in sway-back lean unstudied. Role flagged for review."

---

## Controller adjudications (surface to user)
1. **trunk_lean / hamstrings [weak]** and **trunk_lean / thoracic-erector-spinae [tight]** are graded `low` with citations that state the literature CONTRADICTS the coded role (hamstrings are typically tight not weak in lower-crossed; thoracic ES is inhibited not overactive in slouch). Roles are frozen in Task 2 (grade-only) — these two are content-correctness follow-ups. The Task 6 coherence gate will re-test whether the exercises mapped to trunk_lean still target coherent muscles; if a fix is needed it lands there or as a separate content correction with Devin's sign-off.
2. All grades honor the transferability rule: recurvatum evidence is clinical-gait-population (CP/stroke) — kept but never inflated above medium; textbook-only associations are `low`, not silently promoted.
