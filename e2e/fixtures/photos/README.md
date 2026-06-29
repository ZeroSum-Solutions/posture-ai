# Posture test fixture photos

Interim stock fixtures for the real-detection e2e spec and capture preflight tuning.
Each shows one person in a natural standing position, matching the three assessment
views the wizard captures (front / side profile / back).

| File | View | Source (Pexels, free license) | Notes |
|---|---|---|---|
| `front_standing.jpg` | front (anterior, facing camera) | https://www.pexels.com/photo/7561443/ | Arms relaxed at sides; feet slightly staggered |
| `side_standing.jpg` | side (sagittal profile) | https://www.pexels.com/photo/5960347/ | True 90° profile; hat partially occludes ear — useful as a landmark-visibility edge case |
| `back_standing.jpg` | back (posterior, facing away) | https://www.pexels.com/photo/4469778/ | Hands clasped behind back |

License: Pexels License (free to use, no attribution required, modification allowed).
Source URLs retained above for provenance.

`no-person.png` is a **negative fixture** — a synthetic 100×100 grayscale PNG with no
human subject (generated, not a photo; no license needed). It drives the
no-person-detection path in `capture-errors.spec.ts` (upload → "No person detected" →
submit blocked).

**These are interim fixtures.** The canonical clinical fixture set is the three-view
series captured on a real phone during the P0 device verification run
(see `docs/plans/2026-06-12-p0-device-spike-findings.md`). When that set lands,
replace these files and keep the same filenames so specs don't change.
