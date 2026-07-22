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

These licensed stock and synthetic files are the committed automation fixtures.
Physical-device capture media is governed by
`docs/qa/device-evidence-checklist.md`, remains in a protected external evidence
root, and must never replace or be copied into this directory.
