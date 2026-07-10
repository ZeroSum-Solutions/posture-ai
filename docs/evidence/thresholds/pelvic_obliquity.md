# Literature Review: pelvic_obliquity

**Metric:** Frontal pelvic obliquity — angle from horizontal of the line connecting the two
hip landmarks (ASIS / iliac-crest proxy) in a standing front-view photograph.
**Engineering defaults under review:** warn = 2°, danger = 5°
**Sweep date:** 2026-07-04
**Databases queried:** PubMed (via direct WebSearch/WebFetch of NCBI), ResearchGate,
Journal of Experimental Orthopaedics, Frontiers in Psychology, Scientific Reports

---

## 1. Search Summary

Six searches were run across PubMed/PMC and the general scholarly web targeting:
pelvic obliquity photogrammetry normative degrees; frontal pelvic tilt surface goniometry
healthy adults; SAPO / biophotogrammetry pelvic angles; rasterstereography pelvic obliquity
normative; iliac crest angle inclinometer healthy population; and lateral pelvic tilt 2D photo
posture screening.

Key finding: the peer-reviewed photographic literature does not contain a direct 2D-photo
normative study of iliac-crest / ASIS line angle from horizontal with validated clinical
cut-points. However, three surface-based (non-radiographic) studies do report pelvic
obliquity in degrees from exactly the same anatomical construct (iliac crest or PSIS
dimple line angle from horizontal), and one provides an explicit classification scheme.
Radiographic studies (inter-teardrop line on AP pelvis X-ray) were identified and
excluded from adoption. No mm-only studies were adopted (two mm-only studies are
listed in the candidate table for completeness).

---

## 2. Candidate Values

| Construct | Population | Reported value (°) | Citation | Transferable? |
|---|---|---|---|---|
| Iliac crest angle (ICA) and ASIS angle (ASISA) from horizontal; surface inclinometer (Duometer, 1° accuracy) | n=300 healthy young adults (150 F, 150 M), age 19–29 y, Poland; no locomotor dysfunction | ICA mean: F 1.6 ± 1.72°, M 2.0 ± 1.75°; ASISA mean: F 1.8 ± 1.7°, M 2.3 ± 1.72°. Classification: slight ≥1° ≤3°, moderate >3° ≤6°, significant >6° (author-derived percentile categories) | Bibrowicz K et al. 2023, *Front Psychol* 14:1148239. doi:10.3389/fpsyg.2023.1148239 | YES — surface inclinometry of iliac crest / ASIS from horizontal is conceptually identical to 2D photographic angle measurement of the same landmarks; closest available analog |
| Pelvic obliquity (PSIS dimples from horizontal); surface rasterstereography (Spine 3D LiDAR) | n=175 healthy adults (85 M, 90 F), age 22–35 y | M: 1.64 ± 2.89°; F: 0.46 ± 2.62°; no significant sex difference (p=0.101). Estimated 95th pctile ≈ 5.5° | Roggio F et al. 2023, *Sci Rep* 13:4263. doi:10.1038/s41598-023-31491-1 | PARTIAL — rasterstereography of PSIS dimples (posterior surface), not frontal ASIS/iliac crest line; estimates translate directionally but not landmark-for-landmark |
| Pelvic obliquity (PSIS dimples); DIERS Formetric 4D surface topography | n=100 asymptomatic women, age 20–64 y (mean 39.8 y) | Mean −0.1° ± 1.2°; not significantly different from 0° (p=0.394) | Wolf C et al. 2021, *J Orthop Surg Res* 16:703. doi:10.1186/s13018-021-02843-2 | PARTIAL — surface topography of PSIS region (posterior); tight range reflects posterior landmark proximity to midline; use as lower-bound reference only |
| Pelvic obliquity (inter-teardrop line from horizontal); AP pelvis radiograph | n=134 healthy adults (70 F, 64 M), mean age 39.7 ± 16.8 y | Median 2.0° (IQR 0.9°–3.1°); 95th percentile = 5.6° | Moharrami A et al. 2023, *J Exp Orthop* 10:57. doi:10.1186/s40634-023-00613-z | NO — radiographic (teardrop landmarks visible only on AP X-ray); REJECTED per protocol |
| Pelvic obliquity (PSIS dimples from horizontal); rasterstereography (DIERS Formetric) — mm only | n=100 healthy, mean age 34 y | 4.23 ± 4.23 mm (no degree conversion available without inter-landmark distance) | Betsch M et al. 2013, *Eur Spine J* 22(6):1354–1361. doi:10.1007/s00586-013-2720-x | NO — mm-only |
| ASIS height difference; 3D opto-electronic stereo-photogrammetry (27 skin markers) | n=124 healthy adults (67 M, 57 F), age 18–35 y | |ΔASIS| mean 7.76 ± 5.37 mm (no degree conversion available) | D'Amico M et al. 2017, *PLoS One* 12(6):e0179619. doi:10.1371/journal.pone.0179619 | NO — mm-only |

---

## 3. Verdict

**ADOPT warn=3 danger=6**

Primary citation:
> Bibrowicz K, Szurmik T, Ogrodzka-Ciechanowicz K, et al. 2023 (*Front Psychol* 14:1148239) — ICA (iliac crest angle from horizontal) and ASISA (ASIS angle from horizontal) measured with surface inclinometer in n=300 healthy young adults 19–29 y: slight asymmetry defined as ≥1° ≤3°, moderate asymmetry >3° ≤6°, significant asymmetry >6°; surface inclinometry of identical anatomical landmarks (iliac crest / ASIS from horizontal), functionally equivalent to 2D frontal photograph angle; thresholds are percentile-based (not validated against clinical outcomes).

Supporting citation:
> Roggio F et al. 2023 (*Sci Rep* 13:4263) — rasterstereography (surface, n=175 healthy 22–35 y), pelvic obliquity 1.64 ± 2.89° (M) / 0.46 ± 2.62° (F); estimated 95th percentile ≈ 5.5°; PSIS dimples (posterior), not ASIS/iliac crest (anterior); supports danger ceiling ≈ 6°.

**Rationale for threshold changes:**

| Threshold | Engineering default | Literature basis | Recommended |
|---|---|---|---|
| warn | 2° | Below the 75th percentile of healthy adults in Bibrowicz (mean ICA ≈ 1.6–2.0°, SD ≈ 1.7°); warn=2° would flag ~50% of healthy male subjects | **3°** (onset of "moderate asymmetry"; ≈75th percentile of healthy population) |
| danger | 5° | Falls mid-range in Bibrowicz "moderate" band (>3°–6°); below the population 95th percentile (≈5.5° from Roggio, 5.6° radiographic from Moharrami) | **6°** (onset of "significant asymmetry" per Bibrowicz; aligns with ≈95th–99th percentile) |

**Caveats:**

1. Bibrowicz classification thresholds are **percentile-derived from a healthy reference population**, not validated against clinical symptoms, pain, LLD, or scoliosis outcomes. They describe distributional rarity, not pathology.
2. No true 2D frontal photograph normative study with degree-based cut-points was found. Bibrowicz uses a handheld surface inclinometer — functionally analogous to photographic angle measurement but not identical in method.
3. The Roggio PSIS-dimple data (posterior surface, rasterstereography) gives a systematically lower mean (~0.5–1.6°) than Bibrowicz ASIS/iliac-crest data (~1.6–2.3°), consistent with posterior landmarks being closer to the spine midline. Frontal-photo landmarks (ASIS / hip landmark proxy) align better with the Bibrowicz values.
4. Moharrami 2023 (radiographic, 95th percentile = 5.6°) is REJECTED for direct adoption but its convergence with the surface-based 95th percentile estimate (~5.5°, Roggio) lends indirect support to the danger=6° ceiling.

---

## 4. PROXY_NOTE graduation

**Partially graduates.** The Bibrowicz surface inclinometer study measures the same anatomical construct (ICA / ASISA angle from horizontal) as a frontal-plane 2D photo, and the adopted thresholds (warn=3°, danger=6°) are grounded in peer-reviewed normative data from a healthy reference population (n=300). However, because no 2D-photograph-specific normative study with photogrammetric angles was identified, a reduced PROXY_NOTE should be retained indicating: *"warn/danger thresholds derived from surface inclinometry norms (Bibrowicz 2023, n=300); no direct 2D photogrammetric normative study available."*

---

## References

1. [Bibrowicz K et al. "Asymmetry of the pelvis in Polish young adults." *Front Psychol* 2023;14:1148239](https://pmc.ncbi.nlm.nih.gov/articles/PMC10075204/) — Surface inclinometer (Duometer), ICA and ASISA from horizontal, n=300 healthy adults 19–29 y.
2. [Roggio F et al. "Thermography and rasterstereography as a combined infrared method to assess the posture of healthy individuals." *Sci Rep* 2023;13:4263](https://pmc.ncbi.nlm.nih.gov/articles/PMC10015043/) — Rasterstereography (Spine 3D LiDAR), PSIS dimples, n=175 healthy 22–35 y.
3. [Wolf C et al. "Evaluation of 3D vertebral and pelvic position by surface topography in asymptomatic females." *J Orthop Surg Res* 2021;16:703](https://pmc.ncbi.nlm.nih.gov/articles/PMC8642978/) — DIERS Formetric 4D surface topography, PSIS dimples, n=100 asymptomatic women 20–64 y.
4. [Moharrami A et al. "Slight pelvic obliquity is normal in a healthy population: a cross-sectional study." *J Exp Orthop* 2023;10:57](https://pmc.ncbi.nlm.nih.gov/articles/PMC10229507/) — AP pelvis radiograph, inter-teardrop line, n=134 healthy adults. REJECTED (radiographic).
5. [Betsch M et al. "Determination of the amount of leg length inequality that alters spinal posture in healthy subjects using rasterstereography." *Eur Spine J* 2013;22(6):1354–1361](https://pubmed.ncbi.nlm.nih.gov/23479027/) — DIERS Formetric rasterstereography, PSIS dimples, n=100 healthy. REJECTED (mm-only).
6. [D'Amico M et al. "Normative 3D opto-electronic stereo-photogrammetric posture and spine morphology data in young healthy adult population." *PLoS One* 2017;12(6):e0179619](https://pmc.ncbi.nlm.nih.gov/articles/PMC5480974/) — 27-marker skin marker stereophotogrammetry, n=124 healthy 18–35 y. REJECTED (mm-only for pelvic obliquity).
