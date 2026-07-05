# Tier B capture protocol — real phones, measured ground truth

Volunteers: 3–5 adults. Each gives a written OK ("I agree my posture photos are
used to test measurement accuracy; photos stay on Devin's machines and are
never published or committed"). Photos NEVER enter git — only extracted
landmark JSON + the measured angles below.

## Setup
- Plain wall, plumb line (string + weight) taped from ~2 m height.
- Phone on tripod/stack at subject mid-hip height, 3.0 m back (tape-measure).
- Inclinometer app open (e.g. iOS Measure > Level): phone roll/pitch within ±1°.
- Marker tape on floor for subject feet (repeatable stance, shoulder width).

## Poses per subject (front AND side for each)
1. neutral — stand comfortably tall
2. staged-trunk-lean — lean whole trunk forward until a second phone held
   against the sternum-to-hip line reads ~8° from vertical; record the number
3. staged-shoulder-drop — small folded towel under one foot (~3 cm) → measured
   shoulder/pelvic tilt; record the towel height and which side
4. staged-forward-head — jut chin forward to a comfortable maximum; a helper
   holds a protractor/phone along ear-to-shoulder and records the angle

## Repeats and devices
- Every pose × 3 REPEATS. Between repeats: lower the phone, step away, re-frame
  from the floor tape. (This measures re-positioning repeatability — the number
  the burst's stabilityScore cannot see.)
- Repeat the full set on BOTH: iPhone Safari and Android Chrome.

## Recording ground truth
For each photo write one line in `golden/photos-local/manifest.csv`:
`subject,pose,view,repeat,device,measured_angle_deg,notes`

## Ingestion
1. `npm run dev`, open http://localhost:3000/dev/golden-ingest
2. Drop each photo; the page runs the real detectPose and downloads
   `<name>.landmarks.json`
3. Move the JSON to `golden/tierb/<subject>/`, fill `groundTruth` from the
   manifest, commit. Photos stay in `golden/photos-local/` (gitignored).
