# Tier B capture protocol — real phones, measured reference poses

Volunteers: 3–5 adults. Each gives a written OK ("I agree my posture photos are
used to test short-term measurement repeatability; photos stay on Devin's
machines and are never published or committed"). Photos NEVER enter git — only
extracted landmark JSON + the measured reference angles below. This pilot does
not establish clinical validity or population accuracy.

## Setup
- Plain wall, plumb line (string + weight) taped from ~2 m height.
- Phone on tripod/stack at subject mid-hip height, 3.0 m back (tape-measure).
- Inclinometer app open (e.g. iOS Measure > Level): phone roll/pitch within ±1°.
- Marker tape on floor for subject feet (repeatable stance, shoulder width).

## Minimum pilot workload

Start with the protocol minimum: 3 adults × 4 poses × 2 views × 3 re-positioned
repeats × 2 devices = **144 photos**. Finish one subject/device block at a time
and verify its manifest rows before moving on. This is the shortest dataset that
meets the current pilot design; do not cut repeats or devices to save time.

Capture each photo once and keep it only in `golden/photos-local/`. The same local
photo can be re-ingested with another pose model later, so a lite/full comparison
does not require asking volunteers to repeat the physical session. Re-ingestion
creates another computational output, not another biological observation: the
144-photo minimum still contains only 3 independent adults and cannot establish
model or platform interchangeability.

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
1. Run `NEXT_PUBLIC_POSE_MODEL=lite npm run dev`, then open
   http://localhost:3000/dev/golden-ingest. The downloaded JSON records the
   selected `poseModel` and protocol version; the repeatability harness rejects
   missing, mixed, or incompatible provenance.
2. Drop each photo; the page runs the real detectPose and downloads
   `<name>.landmarks.json`
3. Move the JSON to `golden/tierb/<subject>/`, fill `groundTruth` from the
   manifest, commit. Photos stay in `golden/photos-local/` (gitignored).
4. Rename each file to `<pose>_<view>_<device>_r<repeat>.landmarks.json`
   (e.g. `staged-trunk-lean_side_iphone_r2.landmarks.json`) — this is how
   `scripts/golden-repeatability.ts` groups repeats. Pose and device names:
   lowercase, digits and hyphens only.

## Analysis
`npx vite-node scripts/golden-repeatability.ts` — per-metric test-retest
ICC(2,1)/SEM/MDC95 across the re-positioned repeats, written to
`golden/reports/reliability-profile.json`. The profile reports separate degree
and severity-percentage-point statistics, remains labeled `pilot`, and carries
`consumerEligible: false` until confidence-interval and clustered-uncertainty
requirements are resolved. It must not gate report comparisons in that state.
Its estimand is immediate, within-session re-positioning repeatability—not
day-to-day posture variation, clinical validity, population performance, or
equivalence between devices and pose models.
