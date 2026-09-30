# Clinical-content governance evidence — PR-07

Status: engineering gate implemented; HG-03 not applicable for the frozen
assessment-only beta and still required before any clinical surface is enabled.

## Governed inventory

The canonical artifact is `content/clinical-content-inventory.json`.

| Kind | Count |
|---|---:|
| Muscles | 29 |
| Exercises | 73 |
| Muscle-to-finding links | 46 |
| Exercise-to-muscle roles | 119 |
| Contraindications | 1 |
| Report-copy records | 12 |
| Recommendation algorithms | 1 |

Inventory SHA-256:
`c797bcf52fc82ba9d95358ef08ddb2dd808572b430d95dae8a55fb9485b84bf6`.

Recommendation algorithm SHA-256:
`84b22e3a9cfb5d4befdb5f94a9e8fb47c7f67792da06bc2bd39e2a7274dee87c`.

A second 2026-09-30 refresh binds the results-page redesign: the 3D posture map as the page
hero (per-side tight/weak coloring labelled as a screening indication), findings that spotlight
their muscles on it, and a muscle detail modal that reads the approved muscle, link, and
exercise-muscle catalog through a new practitioner-gated route
(`/api/clinical-content/muscles/[slug]`, same gates as the `/muscles/[slug]` page). No
authored clinical content changed. Local QA fixture hashes were synchronized; no clinical
review or production activation is implied.

The first 2026-09-30 refresh binds structured left/right laterality on muscle links
(`side: elevated | lowered` on six pelvic-obliquity and posterior-shoulder links, set only
where each link's authored rationale states the side) and the per-side 3D-map adapter.
Six link items, their five parent muscles, and the recommendation-engine fingerprint
changed. Local QA fixture hashes were synchronized; no clinical review or production
activation is implied, and prior review of the changed items is invalidated by design.

The previous inventory refresh (2026-09-09) bound the governed source at that time,
including the assessment-results and exercise-library presentation changes.
Local QA fixture hashes were synchronized with this inventory; no clinical
review or production activation is implied.
The dependency closure also retains `lib/time/calendar.ts`, added for deterministic
UTC calendar formatting in report and comparison surfaces. Changes to either
governed surface invalidate the prior algorithm fingerprint.
Only the recommendation-engine item fingerprint and aggregate inventory
fingerprint changed; content counts and item identities stayed the same. The
current strength-cycle compiler remains outside this PR-07 clinical inventory: it
has no promoted clinical catalog or eligibility-policy approval, and synthetic
practice execution does not create HG-03 approval. Local test-fixture bindings
were refreshed without changing review statuses or live activation data.

The earlier workout-run persistence fix and assessment-completion guard remain. The governed run route uses a revision compare-and-swap,
so an older concurrent request cannot overwrite newer progress. The authenticated
player adapter serializes requests, retries failed saves three times, and shows an
unsaved-progress alert with a manual retry action. Assessment approval, preview, and
workout minting now reject incomplete analyses before findings can become program
input. These changes do not alter measured findings, scoring, recommendation inputs,
clinical copy, or release eligibility. The hash change still invalidates any prior
approval and does not itself approve content.

The algorithm item hashes dosage, prioritization, relationship coherence,
evidence weighting, program construction, server projection, exercise matching,
workout generation, cue generation, every clinical route/page, and the middleware
and navigation gates. A clinical source, rendering path, or access-control change
therefore invalidates the affected approval rather than silently inheriting it.

## Fail-closed consumer matrix

| Consumer | Assessment-only behavior | Approved-release behavior |
|---|---|---|
| Assessment result page | Grade, measured findings, practitioner approval, sanitized assessment PDF only | Server-projected, item-scoped clinical sections |
| Assessment API | No definitions, causes, recommendations, override writes, or projection | Returns only items/dependencies approved by the active release |
| Client/practitioner PDF | Client clinical report denied; practitioner PDF contains measured assessment only | Exact approved report copy and exercises, with immutable release provenance |
| Workout mint/run/rate | Direct requests denied | v3 snapshots bound to the active release and receipt |
| Public workout share | Server route, token resolve, run, and rate denied; revoke remains available | Only active, exact-version v3 snapshots resolve |
| Exercise and muscle libraries/details | Navigation omitted and direct requests return 404 | Source-controlled catalog filtered to approved item/link hashes |
| Exercise/finding detail APIs | Return not found | Authenticated and filtered to the approved dependency set |
| Muscle-viewer and workout-coach assets | Middleware denies direct HTML/SVG/GLB/MP3 requests | Available only while the matching surface is active |
| Historical downloads | Assessment-only reports remain available; legacy/unversioned clinical artifacts rejected | Clinical artifacts require the exact active release/hash |

Browser components never query the clinical catalog tables directly. The complete
catalog and recommendation engine remain on the server. Rendered clinical copy
comes from the exact TypeScript catalog that produced the reviewed hashes, and
the browser receives only a minimized release-scoped projection.

## Dependency closure

- An exercise is eligible only when the exercise, every authored
  exercise-to-muscle role, every parent muscle, and every authored
  contraindication are approved.
- Recommendations also require at least one approved muscle-to-finding link and
  the reviewed recommendation algorithm.
- Programs and workouts additionally require approved report-copy records.
- Knowledge links require both the muscle and its exact relationship record.
- Duplicate, missing, rejected, stale-hash, partial, or mismatched release data
  never broadens access. A release that enables no valid surface resolves to
  disabled.

## Activation authority

`content/clinical-review-ledger.json` intentionally contains no releases. An
approved entry must identify a licensed clinician, license jurisdiction and
identifier, signed receipt hash, exact inventory hash, per-item hash/status/note,
and explicitly enabled surfaces. Runtime activation separately requires the
matching server-only release ID and receipt hash.

The database independently binds report and workout creation/resolution to the
active receipt/release/hash. Every approved runtime path also asks a narrow
security-definer RPC whether the exact source release, inventory, receipt, and
surface tuple matches the private activation pointer; false, error, or transport
failure returns assessment-only. Browser roles cannot read the governance tables,
all application roles are barred from mutation, and only the service role may
read the append-only public ledger. The legacy exercise-media bucket is private,
so provider URLs cannot bypass the runtime gate. Kimi K3, Fable/Anthropic, and
Codex can review implementation and claim scope, but none is the HG-03 clinical
approver.

## Regression evidence

The PR-07 suites cover inventory reconciliation, stale/duplicate/partial review,
relationship and contraindication closure, disabled direct requests, approved
subsets, sanitized PDFs, immutable report/workout provenance, historical artifact
rejection, public share denial, static-asset denial, and browser-side catalog
removal. It also covers source/database activation disagreement and knowledge-only
pages that must not reveal exercise dosage. The database suite covers role
privileges, private media, exact activation attestation, append-only review data,
assessment-only report creation, governed clinical creation, legacy writer
rejection, active-release enforcement, and revocation continuity.

Operational generation, activation, smoke, and rollback steps live in
`docs/RUNBOOK.md`.
