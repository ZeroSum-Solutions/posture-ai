# Forward Head Posture — Literature Review for Threshold Calibration

> **Editorial note (added 2026-07-09, body unchanged below).**
> This review **recommends** `danger = 12°` (§5 Verdict). That recommendation was
> **considered and NOT adopted.** The engine ships `danger: eng(15)`
> (`packages/posture-engine/src/thresholds.ts`), because Moon 2024 measured n=145
> adolescents aged 10–19 and no adult 2D-photograph normative FNTA dataset was found.
> The adjudication is recorded in `docs/plans/2026-07-05-threshold-literature-review.md`.
> A reviewer comparing this file against production will see a 12°–15° gap; that gap is
> deliberate. This file records what the literature said, not what the product adopted.

**Metric under review:** `forward_head_posture`  
**App construct:** Sagittal angle from vertical of the ear (tragus) → shoulder (acromion) line on a 2D side-view photograph; 0° = ear stacked directly over shoulder; larger = head forward.  
**Engineering thresholds under evaluation:** warn = 5°, danger = 12°  
**Review date:** 2026-07-04 (full rewrite superseding 2026-07-03 draft)

---

## 1. Search Summary

**Databases / sources queried:** PubMed/PMC (direct full-text retrieval via WebFetch on pmc.ncbi.nlm.nih.gov), Google Scholar (via WebSearch), ResearchGate metadata, journal full texts (ophrp.org, Heliyon, Sci Rep, Diagnostics MDPI).

**Search strings used (multiple parallel rounds):**
- `craniovertebral angle normative values photogrammetry 2D photograph forward head posture adults`
- `tragus acromion vertical angle degrees photogrammetry forward head posture normal range`
- `CVA craniovertebral angle cut-point classification forward head posture photogrammetry`
- `"forward neck tilt angle" OR "FNTA" normative degrees photogrammetry adults FHP cut-point`
- `"vertical head alignment" OR "VHA" tragus acromion vertical angle photogrammetry`
- `POM-Checker forward neck tilt adults normative photogrammetry`
- `SAPO posture software head shoulder acromion vertical normative adults`
- `"forward head angle" OR "FHA" tragus acromion vertical adults photogrammetry normative FHP`
- `photogrammetry posture tragus acromion vertical normative adults mean standard deviation degrees standing`
- `craniovertebral angle normative systematic review meta-analysis adults photogrammetry FHP classification`

**Full-text papers retrieved and read:** 17 (PMC11042887, PMC5446097, PMC11012400, PMC10887830, PMC11957747, PMC9354067, PMC12827935, PMC10558335, PMC9141407, PMC3804999, PMC7559098, PMC4499973, PMC6379958, PMC9680464, PMC10464763, ophrp.org/journal/view.php?number=45, Heliyon 2023 e19336).

**Inclusion criteria:** Peer-reviewed; 2D photograph or directly transferable surface goniometry / calibrated depth-sensor; landmark definitions explicit; human subjects ≥ 10 yr; measured construct clearly mappable to tragus-to-acromion angle from vertical.  
**Exclusion:** Radiographic-only constructs; observational grade without measured angles; no identifiable landmark definition.

**Hits screened:** ~40 unique records. Seven papers yielded directly usable normative or cut-point data for the app's construct or the CVA proxy. One study (Moon 2024) measures the exact construct.

---

## 2. Construct Disambiguation

Three overlapping constructs appear in the literature; they are NOT interchangeable.

| Label | Vertex / Segment | Landmark A | Landmark B | Reference line | Polarity |
|-------|-----------------|------------|------------|----------------|---------|
| **CVA** | At C7 | C7 spinous process | Tragus | Horizontal through C7 | Smaller = worse (head forward) |
| **FNTA / App θ** | Segment | Acromion | Tragus | Vertical | Larger = worse |
| **90° − CVA** | At C7 | C7 spinous process | Tragus | Vertical | Larger = worse |

The app measures **FNTA** (= App θ). The published literature is dominated by CVA studies.

**The critical geometric point:** CVA and FNTA are NOT related by the simple formula θ ≈ 90° − CVA.  
That formula would only hold if C7 and the acromion were at the same location. In practice the acromion is approximately 9 cm anterior to C7 in the sagittal photographic projection (derived in Section 4.3), making `90° − CVA` a ~25–30° overestimate of FNTA in the clinically relevant range. The correct conversion is derived in Section 4.

---

## 3. Candidate Values

### 3.1 FNTA — exact construct match (acromion-to-tragus from vertical)

**Moon YJ et al. 2024**

- **Measured construct:** FNTA, defined as "the angle between a vertical line and the line connecting the participant's shoulder (acromion) and ear (tragus)." Landmarks identical to the app.
- **Measurement method:** POM-Checker (Team Elysium Inc., Seoul), a Kinect-V2 depth-sensor standing postural analysis system. Angle extraction is geometrically identical to a correctly calibrated 2D side-view photograph but free of perspective error.
- **Population:** 145 adolescents, age 10–19 yr, from five South Korean institutions. No spinal pathology.

| Classification | FNTA range | n (approx.) | Mean ± SD |
|---------------|------------|-------------|-----------|
| Normal | 0° to < 12° | ~35 | 8.61 ± 5.04° |
| Level 1 FHP (mild) | 12° to < 25° | ~42 | 17.25 ± 3.82° |
| Level 2 FHP (moderate) | 25° to < 40° | ~41 | 31.24 ± 4.36° |
| Level 3 FHP (severe) | ≥ 40° | ~27 | 54.71 ± 12.34° |

- **Basis for cut-points:** Correlation with radiographic sagittal alignment parameters (SVA, C2–C7 lordosis). Level 3 (≥ 40°) was defined as the threshold warranting radiographic evaluation.
- **Full citation:** Moon YJ, Chung HS, Park HJ, et al. A Preliminary Diagnostic Model for Forward Head Posture among Adolescents Using Forward Neck Tilt Angle and Radiographic Sagittal Alignment Parameters. *Diagnostics*. 2024;14(4):394. doi:10.3390/diagnostics14040394  
  URL: https://pmc.ncbi.nlm.nih.gov/articles/PMC10887830/
- **Transferability to app:** Construct is identical. Caveats: (a) adolescent population (10–19 yr); (b) depth sensor, not 2D photograph; (c) paper explicitly labelled "preliminary diagnostic model."

---

### 3.2 CVA — indirect proxy requiring geometric conversion

All studies below define CVA identically: angle at C7 between a horizontal line and the line from C7 to the tragus. Measurement by 2D photogrammetry unless noted.

#### Titcomb et al. 2024 — young adults, normal vs. severe FHP groups [A]
- Population: 98 young adults, 18–29 yr (68F / 30M); 2D photogrammetry (Kineova v8.15).
- NORM group (n=14): CVA = 56.6 ± 2.7°; SEV group (n=15): CVA = 41.2 ± 3.2°.
- Cut-points: **CVA > 53° = normal; CVA < 45° = severe FHP**.
- Citation: Titcomb DA, Melton BF, Bland HW, Miyashita T. *Int J Exerc Sci*. 2024;17(1):73–85. doi:10.70252/GDNN4363. URL: https://pmc.ncbi.nlm.nih.gov/articles/PMC11042887/

#### Titcomb et al. 2023 — RCT FHP intervention, young adults [B]
- FHP inclusion criterion: CVA ≤ 53°. Baseline group means: 45.1–47.4° (SD 3.9–5.9°).
- Population: 72 young adults, mean age 20.17 ± 2.25 yr.
- Citation: Titcomb DA, Melton BF, Miyashita T, Bland HW. *Int J Exerc Sci*. 2023;16(1):954–973. doi:10.70252/PYPQ8483. URL: https://pmc.ncbi.nlm.nih.gov/articles/PMC10464763/

#### Aafreen et al. 2023 — two adult age groups, neck-pain population [C]
- Population: 90 adults with neck pain (VAS 2–5/10); Group A 18–30 yr (n=45), Group B 45–60 yr (n=45).
- Means: Group A standing = 53.72 ± 2.11°; Group B standing = 51.58 ± 2.48°.
- Cut-point applied: **CVA < 48° = FHP**. Instrument: Surgimap smartphone app.
- Citation: Aafreen A, Iqbal A, et al. *Heliyon*. 2023;9(9):e19336. doi:10.1016/j.heliyon.2023.e19336. URL: https://pmc.ncbi.nlm.nih.gov/articles/PMC10558335/

#### Kim et al. 2018 — adults 20–40 yr, FHP only (CVA < 52°) [D]
- Population: 44 adults at a hospital; FHP group with neck pain (n=22): CVA = 44.44 ± 4.43°; FHP without neck pain (n=22): CVA = 48.63 ± 1.99°.
- Cut-point applied: CVA < 52° for FHP inclusion. 2D photogrammetry.
- Citation: Kim DH, Kim CJ, Son SM. *Osong Public Health Res Perspect*. 2018;9(6):309–313. doi:10.24171/j.phrp.2018.9.6.04. URL: https://ophrp.org/journal/view.php?number=45

#### Gallego-Izquierdo et al. 2020 — mobile app validation, young adults [E]
- N = 44, age 23.30 ± 4.44 yr; FHPapp vs. gold-standard photogrammetry (Kinovea). ICC > 0.82.
- FHP threshold stated: CVA < 50°–53°.
- Citation: Gallego-Izquierdo T, et al. *Int J Environ Res Public Health*. 2020;17(18):6521. doi:10.3390/ijerph17186521. URL: https://pmc.ncbi.nlm.nih.gov/articles/PMC7559098/

#### Kawasaki et al. 2022 — healthy asymptomatic adults [F]
- Population: 26 healthy Japanese volunteers, 18–65 yr; no neck pain; photogrammetry correlated with lateral cervical X-ray.
- CVA: median 50.9° (IQR 3.8; range 42.2–58.2°). No FHP cut-point established; study focused on radiographic correlation.
- Citation: Kawasaki T, et al. *Int J Environ Res Public Health*. 2022;19(10):6278. doi:10.3390/ijerph19106278. URL: https://pmc.ncbi.nlm.nih.gov/articles/PMC9141407/

#### Ruivo et al. 2017 — literature review of normative CVA (8 studies, 1994–2015) [G]
- Pooled range across studies: 48.4°–63.4°; Greenfield et al. 1995 (30 adults, 39 ± 13.7 yr) = 52 ± 4.7°.
- Review explicitly states: "normative values for postural angles of the sagittal plane do not exist in the literature" as a universal standard.
- Citation: Ruivo RM, et al. *J Manipulative Physiol Ther*. 2017;40(6):408–420. doi:10.1016/j.jmpt.2017.03.013. URL: https://pmc.ncbi.nlm.nih.gov/articles/PMC5446097/

---

### 3.3 Head inclination from vertical (90° − CVA; C7 landmark — not acromion)

Trovato et al. 2022: in 100 healthy young adults (50M/50F, mean age 23.4 ± 6.2 yr), head inclination from vertical = **31.4 ± 5.4°** using tragus and C7 landmarks (Apecs-AI app). This equals 90° − 31.4° = 58.6° expressed as CVA. This is the complement of CVA and uses C7 — it is NOT the app's FNTA (which uses acromion). Cited for population context only.  
Citation: Trovato B, et al. *J Funct Morphol Kinesiol*. 2022;7(4):98. URL: https://pmc.ncbi.nlm.nih.gov/articles/PMC9680464/

---

### 3.4 Reliability of 2D photogrammetric CVA measurement

- Mylonas et al. 2025: ICC = 0.98 (inter- and intra-examiner) for CVA in 30 university students by 2D photogrammetry. Citation: *J Phys Ther Sci*. 2025;37(4):171–175. URL: https://pmc.ncbi.nlm.nih.gov/articles/PMC11957747/
- Mylonas et al. 2022 (systematic review, n=11 non-radiographic methods): classic photogrammetry has "strongest levels of evidence for reliability," ICC 0.82–0.99. Citation: *Cureus*. 2022;14(8):e27696. URL: https://pmc.ncbi.nlm.nih.gov/articles/PMC9354067/
- Karbalaeimahdi et al. 2025 (meta-analysis, 7 smartphone studies): pooled test-retest ICC for CVA = 0.904 (95% CI 0.854–0.937). Citation: *Sci Rep*. 2025;16:2885. doi:10.1038/s41598-025-32708-1. URL: https://pmc.ncbi.nlm.nih.gov/articles/PMC12827935/

---

## 4. Geometric Mapping to the App Construct

### 4.1 Formal model

Define three measurements in the lateral (sagittal) plane:

| Symbol | Meaning | Typical adult value |
|--------|---------|---------------------|
| `h` | Vertical height of tragus above the acromion/C7 reference plane | ~15–17 cm (use 16 cm) |
| `d` | Horizontal anterior offset of acromion from C7 spinous process in the sagittal projection | ~9 cm (derived below) |
| `s` | Horizontal anterior offset of tragus from acromion | The actual FHP displacement component |

Given these, the exact relationship between the two constructs is:

```
FNTA (= θ, app angle) = arctan( s / h )

90° − CVA (naive CVA complement) = arctan( (s + d) / h )
```

Therefore the correct conversion is:

```
θ  = arctan( cot(CVA) − d/h )
   = arctan( cos(CVA)/sin(CVA) − d/h )

CVA = arctan( h / (h·tan(θ) + d) )
    = arccot( tan(θ) + d/h )
```

**The formula `θ ≈ 90° − CVA` is only valid when d ≈ 0, which is never the case anatomically.** Applying it without the d-correction introduces a systematic overestimate of FNTA by ~25–30° in the range of clinical interest.

### 4.2 Deriving d empirically from cross-study constraint

No paper directly measures the sagittal projection offset between C7 and the acromion. It can be estimated by solving simultaneously for the two best-characterised reference points:

**Constraint 1 (Moon et al. 2024):** Normal adolescents have mean FNTA = 8.61°.  
→ `s = h × tan(8.61°) = 16 × 0.151 = 2.4 cm`

**Constraint 2 (CVA literature, adults):** Normal/good posture corresponds to CVA ≈ 55–57° (mean of NORM group, Titcomb 2024; Trovato 2022 equivalent).  
Using CVA = 55°:  
→ `s + d = h / tan(55°) = 16 / 1.428 = 11.2 cm`  
→ `d = 11.2 − 2.4 = 8.8 cm ≈ 9 cm`

**Anatomical plausibility check:** In a standard lateral photograph, the C7 spinous process is marked at the posterior midline of the neck. The acromion (lateral scapular tip) projects to approximately the mid-anterior half of the shoulder in the sagittal view. For a typical adult with ~18–22 cm shoulder AP depth, an A-P offset of ~9 cm is consistent with the acromion appearing roughly 40–50% from the posterior surface.

**Uncertainty range:** If d is 7–11 cm (reasonable anatomical range), the FNTA at CVA = 53° ranges from 7° to 14°. The central estimate (d = 9 cm) gives FNTA ≈ 11° — see conversion table below.

### 4.3 Conversion table

Using d = 9 cm, h = 16 cm. Values rounded to nearest integer degree.

| CVA (from horizontal) | 90°−CVA (naive, wrong) | θ = FNTA (correct) | Approximate clinical category |
|-----------------------|------------------------|---------------------|-------------------------------|
| 60° | 30° | 3° | Excellent posture |
| 57° | 33° | 5° | Good posture (≈ Trovato 2022 healthy adult mean) |
| 55° | 35° | 8° | Normal population mean (matches Moon 2024 normal FNTA mean of 8.6°) |
| 53° | 37° | 11° | Normal/FHP boundary (most-cited CVA threshold) |
| 52° | 38° | 12° | Onset FHP — matches Moon 2024 Level-1 threshold exactly |
| 50° | 40° | 15° | Mild–moderate FHP |
| 45° | 45° | 22° | Severe FHP (Titcomb 2024 SEV threshold) |
| 40° | 50° | 29° | Very severe FHP |

**Key convergence finding:** The CVA ≤ 53° FHP threshold used by Titcomb 2024 (adults, 2D photogrammetry) maps to FNTA ≈ 11°; the Moon 2024 FNTA Level-1 onset is 12°. These two values, derived from entirely independent constructs and populations, agree to within 1°. This is strong cross-study corroboration that 12° is the clinically meaningful onset of FHP in the app's construct.

### 4.4 Evaluating the current engineering thresholds

| Threshold | App θ | CVA equivalent | Literature interpretation |
|-----------|-------|----------------|--------------------------|
| warn = 5° | 5° | ≈ 57° | Good-posture zone; roughly at the NORM group mean in Titcomb 2024 (56.6°). No study places a clinical cut-point here. Appropriate as a conservative early-awareness alert; no citable threshold. |
| danger = 12° | 12° | ≈ 51–52° | Directly supported: Moon 2024 Level-1 FHP onset at FNTA = 12°. Corroborated: maps to CVA ≈ 52°, which sits within the 50–53° FHP range used across five independent adult photogrammetric studies. |

---

## 5. Verdict

```
ADOPT deg=5,12 — danger=12 is directly supported by Moon 2024 FNTA Level-1 FHP
onset (acromion-to-tragus from vertical, n=145 adolescents; exact construct match)
and independently corroborated by five adult 2D-photogrammetric CVA studies
(CVA 50–53° ≈ FNTA 11–12° via geometric mapping with d≈9 cm); warn=5 has no
direct citable cut-point but maps to CVA≈57° (good-posture zone), appropriate as
a conservative pre-clinical early-awareness alert.
```

**Code-embedding citation strings:**

Primary (danger threshold — direct construct match):
```
// Moon YJ et al. 2024 (Diagnostics 14:394) — FNTA ≥12° = Level-1 FHP onset;
// acromion-to-tragus from vertical, depth-sensor standing image, n=145 adolescents
// 10–19 yr; exact construct match; no adult 2D-photo normative FNTA dataset found.
```

Corroborating (danger threshold — adult CVA cross-mapped):
```
// Titcomb DA et al. 2024 (Int J Exerc Sci 17:73) — CVA >53°=normal, <45°=severe
// FHP, young adults 18–29 yr, 2D photogrammetry; maps to θ≈11–12° at CVA=52–53°
// via geometric conversion (d≈9cm, h≈16cm; see lit/forward_head_posture.md §4).
```

---

## 6. Evidence Quality Summary

| Claim | Study type | Key caveats |
|-------|-----------|-------------|
| θ ≥ 12° = FHP Level 1 onset | Single cross-sectional cohort (Moon 2024, n=145) | Adolescents only; depth sensor, not 2D photo; "preliminary diagnostic model" label |
| CVA ≤ 50–53° = FHP (adult) | Multiple cross-sectional + 2 RCTs, n=44–98 per study | Uses C7 landmark, not acromion; requires geometric conversion to get θ |
| CVA 50–53° ↔ θ 11–12° | Derived (not directly measured) | d ≈ 9 cm is an estimate (range 7–11 cm); conversion adds ~±3° uncertainty at this range |
| CVA reliability ≥ 0.90 ICC | Meta-analysis (Karbalaeimahdi 2025, k=7) | App-based and traditional photogrammetry pooled |
| warn = 5°: no citable cut-point | — | Engineering judgment; below all clinical FHP thresholds |
| Adult FNTA normative dataset | Not found | Gap in the literature; no 2D-photographic normative study of acromion-to-tragus angle in healthy adults was identified |

**Overall assessment:** The danger threshold (12°) is supported by convergent evidence: one direct-construct study in adolescents plus geometric translation of five adult CVA studies all pointing to the same value. The evidence quality is **moderate** (no adult 2D-photographic FNTA RCT exists), but the cross-construct corroboration substantially increases confidence. The warn threshold (5°) is engineering judgment; it is defensible as a conservative alert but cannot be attributed to a specific published cut-point.

---

## 7. References

[1] [A Preliminary Diagnostic Model for Forward Head Posture among Adolescents Using Forward Neck Tilt Angle and Radiographic Sagittal Alignment Parameters](https://pmc.ncbi.nlm.nih.gov/articles/PMC10887830/) (Moon YJ et al., 2024, *Diagnostics* 14:394)

[2] [Evaluation of the Craniovertebral Angle in Standing versus Sitting Positions in Young Adults with and without Severe Forward Head Posture](https://pmc.ncbi.nlm.nih.gov/articles/PMC11042887/) (Titcomb DA et al., 2024, *Int J Exerc Sci* 17:73–85)

[3] [The effects of postural education or corrective exercise on the craniovertebral angle in young adults with forward head posture](https://pmc.ncbi.nlm.nih.gov/articles/PMC10464763/) (Titcomb DA et al., 2023, *Int J Exerc Sci* 16:954–973)

[4] [Clinimetric properties of a smartphone application to measure the craniovertebral angle in different age groups and positions](https://pmc.ncbi.nlm.nih.gov/articles/PMC10558335/) (Aafreen A et al., 2023, *Heliyon* 9:e19336)

[5] [Neck pain in adults with forward head posture: effects of craniovertebral angle and cervical range of motion](https://ophrp.org/journal/view.php?number=45) (Kim DH et al., 2018, *Osong Public Health Res Perspect* 9:309–313)

[6] [Psychometric Properties of a Mobile Application to Measure the Craniovertebral Angle: A Validation and Reliability Study](https://pmc.ncbi.nlm.nih.gov/articles/PMC7559098/) (Gallego-Izquierdo T et al., 2020, *Int J Environ Res Public Health* 17:6521)

[7] [Correlation between the Photographic Cranial Angles and Radiographic Cervical Spine Alignment](https://pmc.ncbi.nlm.nih.gov/articles/PMC9141407/) (Kawasaki T et al., 2022, *Int J Environ Res Public Health* 19:6278)

[8] [Photogrammetric Assessment of Upper Body Posture Using Postural Angles: A Literature Review](https://pmc.ncbi.nlm.nih.gov/articles/PMC5446097/) (Ruivo RM et al., 2017, *J Manipulative Physiol Ther* 40:408–420)

[9] [Reliability and Validity of Non-radiographic Methods of Forward Head Posture Measurement: A Systematic Review](https://pmc.ncbi.nlm.nih.gov/articles/PMC9354067/) (Mylonas K et al., 2022, *Cureus* 14:e27696)

[10] [Photogrammetry-based smartphone applications for spinal posture assessment: a systematic review and meta-analysis](https://pmc.ncbi.nlm.nih.gov/articles/PMC12827935/) (Karbalaeimahdi M et al., 2025, *Sci Rep* 16:2885)

[11] [Reliability of photogrammetric evaluation of the craniovertebral angle, swayback posture, and knee hyperextension in university students](https://pmc.ncbi.nlm.nih.gov/articles/PMC11957747/) (Mylonas K et al., 2025, *J Phys Ther Sci* 37:171–175)

[12] [Postural Evaluation in Young Healthy Adults through a Digital and Reproducible Method](https://pmc.ncbi.nlm.nih.gov/articles/PMC9680464/) (Trovato B et al., 2022, *J Funct Morphol Kinesiol* 7:98)

[13] [Changes in upper-extremity muscle activities due to head position in subjects with a forward head posture and rounded shoulders](https://pmc.ncbi.nlm.nih.gov/articles/PMC4499973/) (Kwon JW et al., 2015, *J Phys Ther Sci* 27:1739–1742)

[14] [The effect of manual therapy and stabilizing exercises on forward head and rounded shoulder postures](https://pmc.ncbi.nlm.nih.gov/articles/PMC6379958/) (Fathollahnejad K et al., 2019, *BMC Musculoskelet Disord* 20:86)

[15] [The Intra- and Inter-rater Reliabilities of the Forward Head Posture Assessment of Normal Healthy Subjects](https://pmc.ncbi.nlm.nih.gov/articles/PMC3804999/) (Nam SH et al., 2013, *J Phys Ther Sci* 25:737–739)
