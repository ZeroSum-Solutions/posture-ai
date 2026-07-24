# Tier B v2 reliability protocol

Status: **prepared — collection not authorized**

This protocol freezes the design and tooling for HG-05. It does not authorize
human-subject collection, make a clinical-validity claim, or enable any
reliability number in the product.

## 1. Question and estimand

The question is: when the same person fully steps away, resets, and repeats the
four-view capture during one session, how much do Posture AI's metric outputs
normally change?

The estimand is **short-term, within-session, full re-stance repeatability** of
the reliable-gated pipeline on each exact device. It is not:

- accuracy against an anatomical ground truth;
- day-to-day, operator-to-operator, or clinic-to-clinic reliability;
- clinical validity or diagnostic performance;
- evidence that lite or full should become the scoring default;
- a license to tune thresholds until a metric passes.

## 2. Frozen cohort and capture count

- Posture condition: neutral standing only.
- Independent participants: 12 minimum; 15 target.
- Devices: exactly two named, frozen device configurations.
- Repeats: exactly three complete, independently re-positioned capture rounds
  per participant on each device.
- Slots per round, in protocol order:
  1. `front`
  2. `side_left`
  3. `back`
  4. `side_right`
- Minimum: `12 × 2 × 3 × 4 = 288` unique photos.
- Target: `15 × 2 × 3 × 4 = 360` unique photos.

The same minimum/target participant set must complete both devices. A photo,
slot, repeat, metric, or model output is never counted as an independent
participant.

## 3. Re-stance procedure

For every participant-device block:

1. Begin each repeat with the participant outside the marked stance area.
2. Reset the capture surface and operator prompts.
3. Ask the participant to enter and take a new natural neutral stance without
   matching any prior image.
4. Complete all four slots in the assigned slot order.
5. Ask the participant to leave the marked stance area.
6. Repeat until exactly three complete full re-stances and rounds exist.

Device order alternates by participant slot. The four view orders use a
participant-slot Latin rotation of `front → side_left → back → side_right`.
The authorization packet must freeze that exact assignment before collection.
Do not replace a missing or
unreliable value with zero. Do not silently add a fourth attempt. A required
missing/unreliable cell remains missing and is reported.

## 4. Capture mapping

| Slot | Engine view | Required profile side |
| --- | --- | --- |
| `front` | `front` | none |
| `side_left` | `side` | `left` |
| `back` | `back` | none |
| `side_right` | `side` | `right` |

The authorized capture implementation must preserve this mapping and the exact
participant, device, repeat, and slot identity without exposing those
identifiers in the public evidence envelope.

## 5. Privacy and collection authorization

The checked-in packet is `prepared` and has
`collectionAuthorized:false`. The dev study page must remain visibly locked,
must not instantiate pose inference, and must not accept a file or drop event.
No environment variable or test-only flag may bypass that lock.

Before any volunteer photo is collected or processed, a valid
`collection_authorized` child packet and governed purpose-specific consent are
both required. Packet state is derived from independently trusted
cryptographic evidence, not a mutable state string or a key supplied by the
packet itself.

Original photos and the restricted envelope stay outside the repository in
the authorized local restricted-data root. Public/committable evidence must
not contain:

- participant or consent identifiers;
- original filenames or local artifact paths;
- exact capture timestamps;
- raw user-agent strings or device serials;
- EXIF or GPS;
- raw photo hashes;
- a reversible identity map.

The restricted envelope holds active consent references, the identity map,
exact timestamps, row manifest, and authorized artifact descriptors. Every
included manifest row must have `withdrawalState:"active"`; withdrawn
participants are excluded from the activated participant set and analysis.
The governed consent ledger outside this packet retains withdrawal history.
Artifact reads must be descriptor-bound and reject path escape, symlink
substitution, and content changes between validation and use.
At adjudication it must also contain the deidentified analysis-input envelope.
The validator binds those participants, devices, repeats, and views to the
verified manifest, reruns the frozen engine on every verified landmark
artifact, requires one to five frames per artifact, rejects any individual
frame whose `view` or `profileSide` differs
from its manifest slot even when the artifact envelope claims the correct
mapping, requires the submitted measurement keys to exactly equal the full
derived key set (including every unreliable output as an explicit `null`),
requires every reliable-gated `severityPct` value to match that engine output,
reruns the deterministic statistical analyzer, and
requires the recomputed result to equal the signed public analysis exactly.

## 6. Analysis

Analyze each metric on each exact device. A pooled-device result is descriptive
only.

The primary measurement is the engine's reliable-gated `severityPct` output in
percentage points, constrained to `[0, 100]`. Degree outputs cannot be inserted
and relabeled as percentage points.

For a balanced participant-by-repeat matrix of untransformed `severityPct`
values:

- report signed `ICC(A,1)` / `ICC(2,1)` (do not clamp a negative ICC) as a
  secondary statistic;
- compute agreement
  `SEM = sqrt(MSE + max(0, (MS_repeat - MSE) / n_participants))`;
- also report consistency `SEM = sqrt(MSE)` for transparency;
- compute `MDC95 = 1.96 × sqrt(2) × agreement SEM`;
- report missing and unreliable cells explicitly, never as zero.

Neutral standing can restrict between-participant range and depress ICC even
when absolute error is small. Agreement SEM and MDC95 therefore lead the
decision; ICC is a supporting description.

An exact device/metric/view cell is eligible only when all frozen gates pass:

- 12 or more participants have all three reliable repeat values;
- total missing plus unreliable metric cells are at most 20%;
- the statistics are defined and finite;
- exactly 10,000 bootstrap attempts were consumed and at least 9,500 were
  valid.

A candidate metric can be eligible only if every required view passes on both
exact devices. Its conservative consumer MDC95 is the maximum upper endpoint
of the 95% participant-bootstrap MDC interval across those passing primary
cells. A statistical reviewer may demote a passing metric with an explicit
signed reason, but may never promote a failed metric. Cross-device pooling is
descriptive only and cannot rescue a failed primary cell.
`pelvic_axial_rotation` remains excluded by design.

Uncertainty uses a deterministic participant-cluster bootstrap within each
exact device/metric/view complete-case matrix:

- 10,000 attempted resamples;
- resample whole participant rows with replacement;
- retain all three repeat values within each sampled participant row;
- require at least 9,500 valid attempts;
- record invalid attempts; do not retry them;
- use type-7 percentile intervals.

## 7. Lifecycle and decisions

The evidence lifecycle is:

`prepared → collection_authorized → adjudicated`

Every transition creates an immutable child packet that binds the parent hash,
protocol/configuration/source hashes, exact manifest, repository commit,
engine, model, and public/restricted envelope hashes. Authorization and
adjudication require independently pinned production trust roots; the
checked-in production key list is intentionally empty.

PR 10 may prove that the prepared packet is internally valid. It must prove
that authorization and adjudication fail without the separate trusted
evidence. Only HG-05 may collect the participants, enter real signing keys,
adjudicate metric eligibility, or supply product-consumable values.
The Tier B-specific consent persistence, withdrawal workflow, and real receipt
issuer are intentionally not implemented in PR 10; HG-05 must implement and
independently review them before creating any collection authorization.

For HG-05, the production trust-policy pin must be distributed and verified
out of band from the evidence packet and signing-key custodians. Keeping the
prepared empty policy and its hash in this repository is only a fail-closed
development baseline, not independent production key custody.

The JSON files under `schemas/` are documentation and exchange aids. The
fail-closed TypeScript validator is the executable authority and pins every
prepared-packet constant, including the estimand; schema files alone never
authorize collection or establish consumer eligibility.

A failed or imprecise metric is reported and then demoted, redesigned, or left
ineligible. Thresholds, weights, grade bands, and model defaults are not
changed to manufacture a pass. A protocol change requires a new version and
new parent packet; it may not rewrite this frozen history.

Any later Lite-versus-Full default-model decision must use separately marked
accuracy evidence. The two model files must be symmetrically paired under one
non-empty accuracy protocol and carry the same non-empty set of finite measured
ground-truth metrics with identical values. Only those measured metrics may
enter the disagreement and error comparison; missing pairs, references, or
model findings fail closed, as do unclassified JSON files in the comparison
input directory.
