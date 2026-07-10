# Literature Review: trunk_lean (Sagittal Trunk Inclination from Vertical)

**Date:** 2026-07-04  
**Metric:** `trunk_lean` — angle from vertical of the shoulder (acromion) to hip (greater trochanter) line, 2D lateral photograph  
**Engineering defaults under review:** warn = 3°, danger = 8°  
**Question:** Does a peer-reviewed photogrammetric or photographic normative value / clinical cut-point exist in degrees for this specific construct?

---

## 1. Search Summary

**Databases / methods:** WebSearch restricted to pubmed.ncbi.nlm.nih.gov and pmc.ncbi.nlm.nih.gov; full-text retrieval via WebFetch on eight PMC articles; supplementary searches via Google Scholar snippets. Searches ran on: "sagittal trunk inclination photogrammetry normative," "trunk lean angle photograph degrees normal," "photogrammetric upper body posture normative values sagittal," "vertical trunk inclination angle C7 greater trochanter," "swayback posture photogrammetry acromion trochanter," and related variants.

**Rejection criterion applied:** Radiographic measurements (SVA in mm, spinopelvic parameters on standing X-ray) were excluded. Surface-topographic / 3D photogrammetric measurements (Formetric, MiniRot, SLI scanner) were retained as **closest available evidence** but flagged as non-2D-photograph methods.

**Screened / reviewed:** ~30 papers identified; 8 read in full text; 5 included below as candidate values.

**Key negative finding confirmed:** Singla et al. (2017, PMC5446097), a systematic literature review of photogrammetric upper-body posture angles, explicitly states: *"normative values for postural angles of the sagittal plane do not exist in the literature"* and attributes this to non-uniform measurement protocols across studies.

---

## 2. Candidate Values

| Construct | Population | Reported value (degrees) | Citation | Transferable to posture-ai? |
|---|---|---|---|---|
| Vertical Balance Angle (VBA): angle between vertical and line from **C7 spinous process to top of intergluteal cleft**; 3D custom SLI scanner | n=53, asymptomatic young women, age 20.4 ± 1.2 y | Median **3.5°**, IQR 2.6–5.3°, range **0.0–10.0°** (barefoot baseline) | Michoński J et al. 2019 (Int J Environ Res Public Health 16(22):4556) | PARTIAL — same physical quantity (trunk lean from vertical); landmarks C7/intergluteal differ from acromion/GT; method is 3D scan not 2D photo |
| Sagittal trunk decline: angle of trunk length line (C7 → midpoint PSIS) from perpendicular; 3D ABW-BodyMapper video rasterstereography | n=800 healthy adults 21–60 y (407F, 393M); Germany | Women: median **3.29°**, 2.5th pct **10.38°**, 97.5th pct **1.80° backward**; Men: median **3.24°**, 2.5th pct **8.38°**, 97.5th pct **1.85° backward** | Ohlendorf D et al. 2023 (Sci Rep 13:873) | PARTIAL — same physical quantity; landmarks differ (C7/PSIS vs. acromion/GT); 3D back-surface scan not 2D photo |
| Sagittal trunk inclination: angle of trunk (C7 → PSIS) from vertical; 3D MiniRot Kombi back scanner | n=106 healthy young German women, 21–30 y | Mean **3.31°** forward, tolerance range: **−1.50° (dorsal) to 8.12° (ventral)**; CI 2.85–3.78° | Ohlendorf D et al. 2018 (BMJ Open 8(8):e022236) | PARTIAL — same physical quantity; landmarks differ; 3D scan not 2D photo |
| Swayback angle: 3-point angle at acromion-**greater trochanter**-lateral malleolus; **2D lateral photograph** | n=30 university students, age 22 ± 1.9 y | ICC = 0.99 (inter- and intra-rater); **no degree normative values or cut-points reported** | Papageorgiou et al. 2025 (J Phys Ther Sci 37(4):171–175) | Method is 2D photo; landmarks closest to posture-ai; but this measures a 3-point angle at the GT (not the shoulder-to-GT-from-vertical angle), and no normative degree values are given |
| 2D photogrammetric upper-body postural angles, sagittal plane (literature review) | Reviews of 2D photographic posture studies | **No normative values exist** for sagittal plane postural angles | Singla D, Veqar Z, Hussain ME 2017 (J Chiropr Med 16(2):131–138) | Direct: confirms absence of 2D photographic normative values for this plane |

---

## 3. Verdict

**NO CITABLE VALUE**

No peer-reviewed 2D photographic study has established normative values or explicit clinical cut-points in degrees for the sagittal trunk inclination angle as measured from the shoulder (acromion) to hip (greater trochanter) line against vertical. The 2017 systematic review (Singla et al.) explicitly confirms this gap for 2D photogrammetry. The 2D reliability study most closely matching the landmark pair (Papageorgiou 2025, acromion–greater trochanter–lateral malleolus, ICC=0.99) provides no normative degree values. The 3D back-surface photogrammetric normative series (Ohlendorf 2018, 2023; Michoński 2019) measures the same physical quantity (whole-trunk forward lean from vertical) with consistent findings — healthy adult mean ~3.3°, range 0–10° — but uses C7-to-PSIS landmarks with 3D scanning rather than the acromion-to-greater-trochanter measurement in a 2D photograph. Direct adoption of those values as cut-points for the posture-ai measurement is not valid without calibration, because the acromion is typically anterior to C7 in the lateral view (especially in subjects with shoulder protraction), meaning the 2D shoulder-to-hip measurement will systematically overestimate forward lean relative to the 3D C7-to-PSIS measurement.

### What the normative data does imply (informational, not adoptable as peer-reviewed cut-points)

The 3D photogrammetric data consistently shows:

- Mean healthy trunk lean ≈ **3.3°** forward (median across studies)
- Upper quartile (75th pct): ≈ **5.3°** forward
- 95th percentile of healthy adults: approximately **8–10°** forward
- warn = 3° (current default) falls at the healthy population **median** — it would flag ~50% of healthy adults, making it clinically non-specific
- danger = 8° (current default) falls at approximately the **90th–97.5th percentile** of the healthy reference range across studies, which is broadly consistent with a "flagging the tail" heuristic, though derived from different landmarks and method

The engineering defaults bracket the normative distribution in a plausible way, but they are not derived from or validated against a published photographic study of the specific shoulder-to-hip vector.

### Does this graduate from PROXY_NOTE?

**No.** Remains PROXY_NOTE. No citable photogrammetric study of the 2D shoulder-to-hip vector from vertical provides peer-reviewed cut-points. The 3D normative data provides contextual support but cannot substitute for direct 2D photographic validation of this landmark pair.

---

## References

1. Singla D, Veqar Z, Hussain ME. Photogrammetric Assessment of Upper Body Posture Using Postural Angles: A Literature Review. J Chiropr Med. 2017;16(2):131-138. doi:10.1016/j.jcm.2017.01.005. PMC5446097.

2. Michoński J, Witkowski M, Glinkowska B, Sitnik R, Glinkowski W. Decreased Vertical Trunk Inclination Angle and Pelvic Inclination as the Result of Mid-High-Heeled Footwear on Static Posture Parameters in Asymptomatic Young Adult Women. Int J Environ Res Public Health. 2019;16(22):4556. doi:10.3390/ijerph16224556. PMC6888429.

3. Ohlendorf D, Fisch V, Doerry C, Schamberger S, Oremek G, Ackermann H, Schulze J. Standard reference values of the upper body posture in healthy young female adults in Germany: an observational study. BMJ Open. 2018;8(8):e022236. doi:10.1136/bmjopen-2018-022236. PMC6078251.

4. Ohlendorf D, Avaniadi I, Adjami F, et al. Standard values of the upper body posture in healthy adults with special regard to age, sex and BMI. Sci Rep. 2023;13(1):873. doi:10.1038/s41598-023-27976-8. PMC9845304.

5. Papageorgiou E, et al. Reliability of photogrammetric evaluation of the craniovertebral angle, swayback posture, and knee hyperextension in university students. J Phys Ther Sci. 2025;37(4):171-175. doi:10.1589/jpts.37.171. PMC11957747.
