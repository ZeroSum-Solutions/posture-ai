# Array redesign — migration tracker

Replaces the v1 "Posture AI Dark" design system with "Array" (see `/DESIGN.md` v2).
Source of truth for the visual target: the design handoff bundle
(`design_handoff_array_redesign/`), whose eight screens are high-fidelity and
whose `DESIGN.md` is the new contract.

**This branch is not deployable until every route below is migrated.** `globals.css`
was replaced wholesale in the first checkpoint, so any route still referencing a v1
utility class renders unstyled. Checkpoints are internal recovery points.

## Checkpoints

| # | Scope | State |
|---|-------|-------|
| 1 | Tokens, primitives, island nav, Today | done |
| 2 | Clients list + `list_owned_clients_page` RPC migration | pending |
| 3 | Client detail (drops `recharts`) | pending |
| 4 | Review — Findings + Evidence (one checkpoint; shared tab/dock state) | pending |
| 5 | Exercise library (establishes the session-builder contract) | pending |
| 6 | Workout player (consumes that contract) | pending |
| 7 | Capture — characterization tests first, presentation only | pending |
| 8 | Repository-wide v1 purge | pending |
| 9 | External audit (Kimi K3) + applied findings | pending |

Capture is last because it is safety-sensitive, not because it is optional: camera
lifecycle, pose-worker messaging, shutter gating and sensor-roll thresholds are
locked by characterization tests **before** any restyle, and that checkpoint carries
no cleanup or dependency removal so a regression stays attributable.

## Designed screens → repo files

1. Today → `app/dashboard/` — **done**
2. Clients → `app/clients/page.tsx`, `app/api/clients/route.ts`, RPC
3. Capture → `app/assessments/new/FullScreenCapture.tsx`, `LiveGuides.tsx`
4. Review · Findings → `app/assessments/[id]/`
5. Review · Evidence → same route, Evidence tab
6. Client detail → `app/clients/[id]/`
7. Exercise library → `app/exercises/`
8. Workout player → `app/workouts/_player/`

## Surfaces the handoff does not draw

These carry no designed screen but reference v1 tokens or classes, so they must be
re-expressed in Array tokens or they ship broken. Grouped by how much judgement each
needs; none may keep a v1 token.

**Forms and flows** (Array form tokens + pill actions, no new layout invention)
`app/clients/ClientForm.tsx`, `app/clients/new/`, `app/clients/[id]/edit/`,
`app/onboarding/`, `app/settings/`, `app/auth/*` (sign-in, sign-up, accept-invite,
forgot-password, update-password, mfa), `components/AuthFrame.tsx`,
`components/InPersonConsentForm.tsx`, `components/ConsentResponder.tsx`,
`components/RemoteConsentButton.tsx`, `components/PrivacyLifecycleControls.tsx`

**Documents** (prose surfaces; body never above 14px)
`app/privacy/`, `app/terms/`, `components/LegalDocumentView.tsx`,
`components/LegalNotice.tsx`, `app/s/[token]/`, `app/consent/[token]/`

**Utility states**
`app/error.tsx`, `app/not-found.tsx`, `app/global-error.tsx`, `app/_components/ConfirmDialog.tsx`,
`app/_components/RouteSkeleton.tsx`, every `loading.tsx`

**Adjacent libraries** (same row/tile vocabulary as Clients)
`app/muscles/`, `app/assessments/[id]/ExerciseDetailSheet.tsx`, `WhyThisSheet.tsx`,
`PriorityProgram.tsx`, `MuscleBodyMap.tsx`, `MuscleModel3D.tsx`

**Marketing** — `app/_components/marketing/` keeps its own composition but must stop
importing v1 tokens.

## Known conflicts and gaps

- **Grade B changes band.** `/DESIGN.md` v2 puts A and B under Maintain. v1
  `lib/scoring/grade-display.ts` maps B to `warning`, and that module still owns the
  **PDF report** palette (`GRADE_TONE_HEX_COLORS`). On-screen band colour now follows
  the contract; the PDF has not been changed. Decide whether the report should follow,
  because a grade B currently reads amber on paper and emerald on screen.
- **No scheduling exists.** The design's "next booked session" row has no backing
  table. Today ships the truthful equivalent — the client longest without a scan —
  and never presents it as a booking. A real booking row needs a scheduling feature.
- **Scan ordinal** (`Scan 03`) needs each client's full history; the queue omits it
  rather than showing a wrong number. Add it when the queue query can join history.
- **Status bar and home indicator** in the prototype are device chrome, not app UI.
  Deliberately not built. Safe-area insets are honoured instead.
- **Ambient photo** is a locally hosted downscale of the Vision Engine reference
  (`public/ambient/field.jpg`, 1080px, 37 KB). It sits under a 4px blur, so more
  resolution buys nothing. Replace with a licensed asset before production.
