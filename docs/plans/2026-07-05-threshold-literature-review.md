# Per-Metric Literature Review: Threshold Calibration
**Date:** 2026-07-05  
**Branch:** feat/threshold-literature-sweep  
**Scope:** 7 metrics / 5 metric families

---

## Summary

| Family | Metrics | Verdict | Action |
|---|---|---|---|
| Forward head posture | `forward_head_posture` | CONSIDERED, NOT ADOPTED | Stays `eng(5,15)` — see rationale |
| Imbalanced shoulders | `anterior_imbalanced_shoulders`, `posterior_imbalanced_shoulders` | NO CITABLE VALUE | Stays `eng(2,6)` |
| Trunk lean | `trunk_lean` | NO CITABLE VALUE | Stays `eng(3,8)` — 3D evidence independently supports defaults |
| Pelvic obliquity | `pelvic_obliquity` | **ADOPT warn=3 danger=6** | `lit(3,…)` / `lit(6,…)` + PELVIC_NOTE |
| Genu varum/valgum | `genu_varum_valgum_left`, `genu_varum_valgum_right` | NO CITABLE VALUE | Stays `eng(5,15)` + **GENU_NOTE misattribution corrected** |

---

## 1. Forward Head Posture (`forward_head_posture`)

### Search Summary
17 PMC papers retrieved and read. Construct disambiguation identified three overlapping measures: CVA (angle at C7 from horizontal), FNTA / App θ (acromion-to-tragus from vertical — the app's exact construct), and the naive 90°−CVA complement. All major clinical studies use CVA; only one paper (Moon 2024) measures FNTA directly.

### Candidate Values

| Study | Construct | Population | Value | Transferable? |
|---|---|---|---|---|
| Moon YJ et al. 2024 (Diagnostics 14:394) | FNTA (acromion→tragus from vertical) — exact match | n=145 adolescents 10–19 yr, depth-sensor | ≥12° = Level-1 FHP onset | PARTIAL — adolescents, depth-sensor, "preliminary" label |
| Titcomb DA et al. 2024 (Int J Exerc Sci 17:73) | CVA (C7→tragus from horizontal), 2D photogrammetry | n=98 young adults 18–29 yr | CVA > 53° = normal, < 45° = severe | CVA, not FNTA; geometric conversion required |
| Aafreen A et al. 2023 (Heliyon 9:e19336) | CVA, smartphone photogrammetry | n=90 adults with neck pain | CVA < 48° = FHP | CVA only |
| Five additional CVA studies | CVA | Various | CVA 50–53° = FHP onset | CVA only |

**Geometric analysis:** CVA and FNTA are not related by 90°−CVA. With an estimated acromion-to-C7 sagittal offset d≈9 cm and tragus height h≈16 cm, CVA=53° maps to FNTA≈11°; CVA=52° maps to FNTA≈12°. This geometric derivation converges with Moon 2024's Level-1 threshold at FNTA=12°.

### Verdict: CONSIDERED, NOT ADOPTED

The danger=12° argument rests on two uncited assumptions: (1) a back-derived anatomical offset (d≈9 cm) to convert adult CVA studies into the app's FNTA construct, and (2) an adolescent→adult population transfer (Moon 2024 is n=145 adolescents, depth-sensor, "preliminary"). For a conservative screening tool, these are stretches, not citable adult 2D-photo transfers.

**Applied:** `forward_head_posture` stays `eng(5, 15)`.

**Evidence trail for Layer-1 revisit:** The Layer-1 validation study should specifically test whether `danger` should move from 15° to 12°. The Moon 2024 (Diagnostics 14:394, n=145, exact FNTA construct) and CVA convergence evidence (five adult 2D-photogrammetric studies pointing to 11–12° via geometric mapping with d≈9 cm, h≈16 cm) make 12° a strong candidate for the literature-cited danger threshold once adult 2D-photo data exists.

**Stays:** `eng(5)` warn, `eng(15)` danger, `PROXY_NOTE` — no adult 2D-photo normative FNTA dataset found.

---

## 2. Imbalanced Shoulders (`anterior_imbalanced_shoulders`, `posterior_imbalanced_shoulders`)

### Search Summary
~40 papers screened; 5 met minimum criteria (2D photograph, shoulder-line angle in degrees). Key searches: photogrammetric posture assessment shoulder height asymmetry normative cut-point; shoulder line obliquity angle degrees 2D photograph.

### Candidate Values

| Study | Construct | Population | Value | Transferable? |
|---|---|---|---|---|
| Trovato et al. 2022 (J Funct Morphol Kinesiol 7:98) | Acromion-line angle from horizontal, 2D photo | n=100 healthy young adults | Anterior: mean 1.3°±1.0°; posterior: 1.5°±1.2° | YES — normative mean only, no cut-point |
| Penha et al. 2017 (J Manipulative Physiol Ther 40:441) | Shoulder obliquity, 2D photo | n=76 non-scoliosis adolescents | Mean 1.9°±1.4° | PARTIAL — no cut-point |
| Matamalas & Bagó 2016 (Eur Spine J 25:3560) | SHA (acromion upper border vs horizontal), 2D photo | n=80 scoliosis patients | SHA < 3° = balanced | NO — 3° is the MDC (measurement precision floor), not a normative cut-point; scoliosis cohort only |
| Zheng et al. 2023 (Sci Rep 13:14273) | Posterior acromion angle, 2D photo | Scoliosis vs non-scoliosis | MDC = 1.54°, difference 1.1° | NO — MDC, no cut-point |

### Verdict: NO CITABLE VALUE

No study provides a validated degree-based cut-point for frontal shoulder-line obliquity in a healthy adult population from 2D photographs. The only degree threshold (Matamalas 2016: 3°) is a measurement precision floor in a scoliosis cohort.

**Applied:** Both shoulder metrics stay `eng(2)` warn, `eng(6)` danger, `PROXY_NOTE`.

---

## 3. Trunk Lean (`trunk_lean`)

### Search Summary
~30 papers screened; 5 included. Searched for: sagittal trunk inclination photogrammetry normative; trunk lean angle photograph degrees; vertical trunk inclination C7 greater trochanter. Key negative finding confirmed: Singla et al. 2017 (J Chiropr Med 16:131) explicitly states normative values for sagittal-plane photographic angles do not exist.

### Candidate Values

| Study | Construct | Population | Value | Transferable? |
|---|---|---|---|---|
| Ohlendorf et al. 2023 (Sci Rep 13:873) | Sagittal trunk decline (C7→PSIS from vertical), 3D rasterstereography | n=800 healthy adults 21–60 yr | Median 3.24–3.29°; 95th pct ≈ 8.4–10.4° | PARTIAL — same quantity, C7/PSIS landmarks, 3D scan |
| Ohlendorf et al. 2018 (BMJ Open 8:e022236) | Trunk inclination (C7→PSIS from vertical), 3D scanner | n=106 healthy young women 21–30 yr | Mean 3.31°; tolerance range −1.5° to 8.12° | PARTIAL — same quantity, different landmarks/method |
| Michoński et al. 2019 (IJERPH 16:4556) | VBA (C7→intergluteal from vertical), 3D scanner | n=53 asymptomatic young women | Median 3.5°, IQR 2.6–5.3°, range 0–10° | PARTIAL — same quantity, different landmarks |
| Papageorgiou et al. 2025 (J Phys Ther Sci 37:171) | 3-point angle at acromion–GT–malleolus, 2D photo | n=30 university students | ICC=0.99 — no degree values reported | YES for method; no normative values |
| Singla et al. 2017 (J Chiropr Med 16:131) | Literature review of 2D photographic sagittal angles | — | No normative values exist | Direct confirmation of gap |

### Verdict: NO CITABLE VALUE

No 2D photographic study provides normative values for the shoulder-to-hip vector from vertical. The 3D photogrammetric data (Ohlendorf, Michoński) cannot substitute for direct 2D photo validation because the acromion sits anterior to C7, introducing systematic overestimation.

**Independent contextual support for current defaults (not adoptable as peer-reviewed cut-points):** The 3D normative data consistently shows mean ≈3.3°, 95th pct ≈8–10°. The current engineering defaults (warn=3°, danger=8°) bracket this distribution: warn=3° aligns with the healthy population median (flagging ~50% of healthy adults — this is a known limitation but a deliberate conservative choice), and danger=8° falls at approximately the 90th–97.5th percentile. This 3D evidence independently corroborates the plausibility of the current defaults even though they are not directly citable.

**Applied:** `trunk_lean` stays `eng(3)` warn, `eng(8)` danger, `PROXY_NOTE`.

---

## 4. Pelvic Obliquity (`pelvic_obliquity`)

### Search Summary
Six searches across PubMed/PMC and the scholarly web targeting: pelvic obliquity photogrammetry normative; frontal pelvic tilt surface goniometry healthy adults; iliac crest angle inclinometer healthy population. No direct 2D-photograph normative study found, but one surface-inclinometry study measures the exact same anatomical construct with an explicit classification scheme.

### Candidate Values

| Study | Construct | Population | Value | Transferable? |
|---|---|---|---|---|
| Bibrowicz K et al. 2023 (Front Psychol 14:1148239) | ICA (iliac-crest from horizontal) + ASISA (ASIS from horizontal); surface inclinometer (Duometer, 1° accuracy) | n=300 healthy young adults 19–29 yr, Poland | Mean ICA: F 1.6±1.72°, M 2.0±1.75°. Classification: slight ≥1°≤3°, moderate >3°≤6°, significant >6° | YES — surface inclinometry of iliac crest/ASIS from horizontal is conceptually identical to 2D frontal-photo line angle |
| Roggio F et al. 2023 (Sci Rep 13:4263) | PSIS dimples from horizontal; rasterstereography (Spine 3D LiDAR) | n=175 healthy adults 22–35 yr | M: 1.64±2.89°; F: 0.46±2.62°; 95th pct ≈5.5° | PARTIAL — posterior landmarks (PSIS), not frontal ASIS; supports danger ceiling |
| Wolf C et al. 2021 (J Orthop Surg Res 16:703) | PSIS dimples; 3D surface topography | n=100 asymptomatic women 20–64 yr | Mean −0.1°±1.2° | PARTIAL — posterior, tight range |
| Moharrami A et al. 2023 (J Exp Orthop 10:57) | Inter-teardrop line; AP pelvis radiograph | n=134 healthy adults | 95th pct 5.6° | REJECTED — radiographic |

### Verdict: ADOPT warn=3 danger=6

**Rationale:**
- warn=2° (old) falls below the mean healthy male ICA (~2.0°) — flagging ~50% of healthy men. warn=3° corresponds to onset of "moderate asymmetry" (Bibrowicz ≈75th percentile).
- danger=5° (old) falls mid-range in Bibrowicz's moderate band (>3°–6°). danger=6° corresponds to "significant asymmetry" onset (≈95th–99th percentile), converging with the Roggio 2023 PSIS 95th percentile (~5.5°).

**Caveats:** Bibrowicz thresholds are percentile-derived, not validated against clinical outcomes. No true 2D frontal-photo normative study with degree cut-points was found; surface inclinometry of the identical landmarks is taken as functionally equivalent.

**Applied:**
```ts
pelvic_obliquity: {
  warn: lit(3, 'Bibrowicz 2023 (Front Psychol 14:1148239) — iliac-crest/ASIS obliquity >3° = moderate asymmetry in n=300 healthy adults (surface inclinometry; functionally equivalent to a 2D frontal-photo line angle).'),
  danger: lit(6, 'Bibrowicz 2023 (Front Psychol 14:1148239) — >6° = significant asymmetry (75th/≈95th healthy percentiles; surface inclinometry, no 2D-photo-specific norm exists).'),
  note: PELVIC_NOTE,
}
```

`PROXY_NOTE` replaced with `PELVIC_NOTE` (reduced residual proxy caveat). `metricValidity` now returns `LITERATURE_CITED` for this metric (validity weight 1.0 → up from 0.5).

---

## 5. Genu Varum/Valgum (`genu_varum_valgum_left`, `genu_varum_valgum_right`)

### Search Summary
Five search passes. Specifically sought: (1) the "Hinman 2012 n=1390" paper cited in GENU_NOTE, (2) any peer-reviewed 2D-photo/goniometric degree cut-point for frontal knee alignment independent of radiographic mechanical-axis, (3) adult surface goniometry normative references.

### Critical Correction Identified

**GENU_NOTE misattribution:** The paper cited as "Hinman 2012, n=1390" does not exist. Two distinct papers were confirmed:

| Paper | Authors | Year | Journal | n | Finding |
|---|---|---|---|---|---|
| Riddle DL et al. | 2012 | Manual Therapy 17(5):459–465 (PMID 22683009) | 1,390 (OAI) | Surface goniometry explains ~20% of mechanical-axis variance (r≈0.50–0.54); authors conclude goniometry "likely does not inform clinical practice" |
| Hinman RS et al. | 2006 | Arthritis Rheum 55(2):306–313 | 40 | Surface goniometry shows NO significant correlation with mechanical axis in medial-compartment OA |

The n=1390/~20% figure belongs to **Riddle 2012**, not Hinman. Hinman 2006 is a separate, smaller study that corroborates the finding (even more negative — no significant correlation at all).

### Candidate Values

| Study | Construct | Population | Value | Transferable? |
|---|---|---|---|---|
| Riddle 2012 (Manual Therapy 17:459) | Surface goniometry vs radiographic mechanical axis | n=1,390 OAI (knee OA) | ≥4° varus proposed; R²≈0.20 | NO — insufficient predictive validity |
| Hinman 2006 (Arthritis Rheum 55:306) | Six clinical alternatives vs radiographic axis | n=40 medial OA | No significant correlation | NO |
| Trovato et al. 2022 (J Funct Morphol Kinesiol 7:98) | Photographic frontal knee angle, mobile app | n=100 healthy young adults | Mean 6.2°±3.3° overall (no cut-point) | NO — descriptive means, no gold-standard validation |
| Sharma et al. 2001 (JAMA 286:188) | Radiographic mechanical axis (HKA) | n=230 knee OA | >5° varus = disease-progression grouping | NO — radiographic throughout |
| da Rosa et al. 2022 (J Chiropr Med 22:72) | Radiographic HKA meta-analysis, 7 studies | Healthy adults | −3° to +3° neutral band | NO — radiographic |

### Verdict: NO CITABLE VALUE — prior confirmed

No peer-reviewed study provides a validated 2D-photographic or surface-goniometric degree cut-point for frontal knee alignment independent of radiographic mechanical-axis measurement. The ~20% variance explanation means 80% of true malalignment is invisible to surface goniometry.

**Applied:** `genu_varum_valgum_left` and `genu_varum_valgum_right` stay `eng(5)` warn, `eng(15)` danger. **GENU_NOTE corrected** to attribute the n=1390/~20% finding to Riddle 2012 (Manual Therapy 17(5):459) and add Hinman 2006 (Arthritis Rheum 55(2):306, n=40) as corroborating evidence.

---

## Applied Changes Summary

| File | Change |
|---|---|
| `packages/posture-engine/src/thresholds.ts` | Added `PELVIC_NOTE`; updated `pelvic_obliquity` entry to `lit(3,…)` / `lit(6,…)` + PELVIC_NOTE; rewrote `GENU_NOTE` to cite Riddle 2012 (not Hinman 2012) |
| `packages/posture-engine/__tests__/thresholds.test.ts` | Removed `pelvic_obliquity` from `PROXY_KEYS`; added pelvic_obliquity LITERATURE_CITED test; added citation-invariant test |
| `packages/posture-engine/__tests__/engine.test.ts` | Added `expect(tl.uncertaintyDeg!).toBeGreaterThan(…)` guard before conditional borderline assertion (Task 9 hardening) |
