# Plan: Integrate the muscle-viewer 3D model into posture-ai (tight=red / weak=blue from screening findings)

> Planned with GPT-5.5 as adversarial verifier over **two** design rounds (round 1 = code-grounded review that read both repos' real source; round 2 = GPT-5.5 via `codex exec`). Every load-bearing claim below was re-verified against source on 2026-06-30. Full hardened design spec: `scratchpad/final_design_v3.md`.
> On approval, copy this to the canonical location `posture-ai/docs/plans/2026-06-30-muscle-viewer-3d-integration.md` (per repo convention).

## Context

posture-ai runs a posture screening (camera/upload → MediaPipe → `@posture-ai/engine` scoring) that produces **findings**, each already enriched by the web API (`GET /api/assessments/[id]`) with `tight_muscle_links: {slug,name}[]`, `weak_muscle_links: {slug,name}[]`, `severity_pct`, and `zone`. Today those findings render only as **2D SVG muscle maps** (per finding). Separately, `~/projects/muscle-viewer` is a Vite/React-Three-Fiber whole-body 3D model that was **purpose-built to be driven by this app**: it exposes `window.muscleViewer.applyMuscleStates([{slug, role, severity?, side?}])` (+ a namespaced `postMessage` channel), embeds via `?embed=1`, and already encodes **tight=red / weak=blue**, severity→intensity, and the slug→mesh mapping.

**Goal:** show an aggregate whole-body 3D body on the results surface (web + mobile) that colors *this assessment's* tight muscles red and weak muscles blue, driven by its findings. This makes the screening result legible at a glance and reuses a model that was designed for exactly this handoff.

## Decisions (locked with the user)

1. **Scope:** Web **and** mobile now. Mobile requires building a real results screen first (see Workstream 3 — it's a mini-epic, sequenced after web).
2. **Placement:** One **aggregate** "Posture Summary (3D)" card; keep the existing per-finding 2D maps.
3. **Color:** Keep the viewer's **severity-graded** red/blue (deeper = higher `severity_pct`); host renders its own flat-swatch legend + "shaded by severity" caption.
4. **Knee (genu varum/valgum):** **Match current 2D behavior** (color both IT-band + adductors regardless of direction). Proper direction-gating is a scheduled shared follow-up, not a blocker.

## Architecture — one embed, two hosts

Embed the **built** muscle-viewer (do **not** re-port R3F into Next). Web frames it in an `<iframe>`; mobile loads it in a `react-native-webview`. Both drive it through the existing `applyMuscleStates` contract (web via `postMessage`, mobile via `injectJavaScript`). Rationale (GPT-5.5-affirmed): reuses the already-verified production build, isolates the ~9 MB GLB + WebGL lifecycle, avoids pulling three/@react-three/fiber/drei/zustand into either host bundle, and is the exact path `muscle-viewer/docs/posture-ai-integration.md` was written for. The same-origin iframe is treated as **first-party encapsulation, not a security boundary** (deferred hardening path noted in Risks).

---

## Workstream 1 — muscle-viewer (shared build changes)

Repo: `~/projects/muscle-viewer`. These make the build embeddable and the handshake robust for both hosts.

- **`vite.config.ts`** — add `base: '/muscle-viewer/'` (fixes absolute-root asset 404s once copied under `/muscle-viewer/`).
- **`src/scene/BodyModel.tsx`** — change `const MODEL_URL = "/model.glb"` → `` const MODEL_URL = `${import.meta.env.BASE_URL}model.glb` ``. Fixes both `useGLTF` and the `useModelStatus` HEAD probe. (Dev URL becomes `http://localhost:5173/muscle-viewer/`.)
- **`src/App.tsx`** — three additions (keep the existing `raw.source !== 'posture-ai'` guard):
  - **Ready handshake (request/response, StrictMode/late-safe):** on mount and on receiving `{source:'posture-ai', type:'hello'}`, reply `ready` to **both** `window.parent?.postMessage(...)` (web iframe) **and** `window.ReactNativeWebView?.postMessage(JSON.stringify({source:'muscle-viewer',type:'ready'}))` (mobile WebView). Reply to *every* hello and re-emit on every mount so a late/duplicate ready can't strand the first apply.
  - **Command hardening:** in `onMessage`, after the source check, require `Array.isArray(raw.states)` and `raw.states.length <= 200` for `applyMuscleStates`/`set`; ignore unknown types. (`normalizeAssessment` already drops malformed entries.)
  - **E2E read helper:** expose `getAssessment()` on `window.muscleViewer` returning the store's `assessment` map, so tests can assert applied coloring.
- **NEW build manifest** — emit `dist/muscle-ids.json = { ids: [...MUSCLE_BY_ID keys], aliases: {...SLUG_ALIASES} }` via a `closeBundle` Vite hook or a `scripts/emit-muscle-ids.ts` in the `build` script. This is the single source of truth posture-ai's coverage test + adapter consume (kills slug drift between the two repos).
- **`docs/posture-ai-integration.md`** (~line 73) — replace the false "matches the 2D map" hex-parity claim with: *3D uses an intensity-graded red/blue scale; 2D uses flat red/blue; both follow red=tight/blue=weak; the SET of colored muscles is identical, the exact hex is not.* Fix stale "~27 map" → "29".

---

## Shared — the data adapter (pure, framework-free)

Create **`findingsToMuscleStates(findings) → { states, notShown, collapsedConflicts }`** as a **framework-free module importable by both web and mobile** (new `packages/muscle-map/` workspace, or colocated + monorepo-imported). Reuse the existing `COORDINATE_NAME_TO_SLUG` + `normalizeMuscle` from [muscleMap.ts:103](app/assessments/[id]/muscleMap.ts) (relocate into the shared module and re-export from `muscleMap.ts` if mobile can't import from the web app dir). **Do not** duplicate slug→id / role→color / severity→intensity — the viewer's `fromMuscleStates` owns those. Algorithm (immutable; never mutates `findings`):

- **A. Reliability filter:** skip `finding.zone === 'unreliable'`. **Do not** reference `finding.reliable` — that field does **not** exist on the results-page `Finding` shape (verified; only `zone` does, and the page already filters on `zone`).
- **B. Per-role source selection (legacy fallback, mirrors `regionsForRole`):** emit from `finding.<role>_muscle_links` when non-empty; else resolve `finding.<role>_muscles` (legacy names) via `COORDINATE_NAME_TO_SLUG`+`normalizeMuscle`; else nothing. (Links are empty until the KB is seeded — links-only would show a **blank 3D while 2D renders**.) `severity_pct` is finding-level (shared by all its links).
- **C. Severity sanitization:** clamp to finite `0..100`; else `undefined` (→ viewer default intensity 2).
- **D. Side:** omit (bilateral) — matches the 2D map, which is also non-lateral. Laterality deferred (must land in both maps together).
- **E. Genu direction:** emit both IT-band + adductor links for any genu finding (match 2D). Leave a `// TODO(genu-direction)` seam.
- **F. Dedup by slug:** same slug+role → keep max severity; tight-vs-weak conflict → higher-severity role wins, tie → tight; record collapsed slug in `collapsedConflicts` (surfaced as a card note). One entry per slug.
- **H. Diagnostics:** `notShown` = emitted slugs whose id isn't in `RENDERABLE_SLUGS` (computed from `muscleIds.generated.json`) + unresolved legacy catch-alls. Empty in practice today (all 29 posture-ai content slugs map; 0 unmapped).

---

## Workstream 2 — posture-ai web (results-page 3D)

- **[next.config.ts](next.config.ts)** — the #1 blocker. The global block sets `frame-ancestors 'none'` on `source: '/:path*'`, which blocks framing by everyone incl. same-origin; Next 16 merges headers **last-write-wins**, so merely adding a viewer block fails. Fix (make CSPs **non-overlapping**):
  - Change the global source to `'/((?!muscle-viewer).*)'` (path-to-regexp negative-lookahead) so it never matches the viewer.
  - Add a self-contained `/muscle-viewer/:path*` block: CSP with `frame-ancestors 'self'`, `script-src 'self' 'wasm-unsafe-eval'` (external module scripts only — start without `'unsafe-inline'`; re-add only if an E2E CSP violation appears), `worker-src 'self' blob:`, `connect-src 'self'`, `object-src 'none'`, plus `X-Content-Type-Options`/HSTS (no longer inherited).
  - **Cache split** (keep cache keys in separate blocks so order is irrelevant): hashed `/muscle-viewer/assets/*` → `immutable`; `/muscle-viewer/index.html` → `no-cache`; `/muscle-viewer/model.glb` → short `max-age=86400` (unversioned — never `immutable`).
- **NEW `app/assessments/[id]/MuscleModel3D.tsx`** (`'use client'`) — the aggregate card:
  - `useMemo(() => findingsToMuscleStates(findings), [findings])`.
  - **Click-to-mount** (no IntersectionObserver auto-load): default = placeholder card + "Show 3D model" button + host legend + diagnostic notes; the `<iframe src="/muscle-viewer/index.html?embed=1&legend=0" title="Posture Summary 3D model">` is created only on click, so the ~9 MB GLB never downloads without intent.
  - **Handshake:** on mount, attach a `message` listener (validate `event.origin === location.origin` **and** `event.source === iframe.contentWindow` **and** `data.source==='muscle-viewer' && data.type==='ready'`), and poll `{source:'posture-ai',type:'hello'}` every 300 ms (cap ~12 s; keep listening past the cap for late recovery). On each valid `ready`, post `{source:'posture-ai',type:'applyMuscleStates',states}` with `targetOrigin = location.origin`; re-post on `states` change.
  - **Legend + attribution:** host renders flat `#EF4444`/`#6366F1` swatches + "shaded by severity" caption, and the required **BodyParts3D CC-BY-SA attribution** (since `?embed=1` hides the viewer's own).
  - **Lifecycle:** never remount the iframe on id change; on unmount `clearInterval` + `removeEventListener` + guarded best-effort `clear` post.
  - **Failure UX:** GLB 404 surfaces as the viewer's recoverable placeholder / canvas-error message — never takes down the page.
- **[page.tsx](app/assessments/[id]/page.tsx)** — mount `<MuscleModel3D findings={findings} />` after `SkeletalDiagramSection` and before the findings list (guard `findings.length > 0`). `findings` already in state.
- **NEW `public/muscle-viewer/**`** — copied `dist/` (built with the sub-path base), committed for v1 (~10.4 MB; documented as generated). **NEW `app/assessments/[id]/muscleIds.generated.json`** — copied from `dist/muscle-ids.json`.
- **`package.json`** — `sync:muscle-viewer`: `pnpm -C ../muscle-viewer build && rm -rf public/muscle-viewer && cp -R ../muscle-viewer/dist public/muscle-viewer && cp ../muscle-viewer/dist/muscle-ids.json app/assessments/[id]/muscleIds.generated.json`.
- **CI drift guards** (cheap): assert `public/muscle-viewer/index.html` references `/muscle-viewer/assets/` (not bare `/assets/`); assert `muscleIds.generated.json` equals the viewer's `dist/muscle-ids.json` when both repos present.

---

## Workstream 3 — posture-ai mobile (results screen + 3D)  ⚠ larger prerequisite

Mobile ([mobile/src/FixtureAssessmentScreen.tsx](mobile/src/FixtureAssessmentScreen.tsx)) is today a **fixture-only tracer**: one toggle screen, runs `assessPosture()` on static data at module scope, lists findings as text, **no auth, no API fetch, no muscle data, no `react-native-webview`, no navigation lib**. The 3D card has nothing to attach to until a real results surface exists. Sequence:

- **C1 — Resolve prerequisites first (read, don't assume):** confirm the mobile **auth model** (Supabase session on mobile? none today), the **API base URL** config for device/emulator, and whether/how mobile **submits** captures to `POST /api/assessments` and obtains an `assessmentId` (inspect `CameraCaptureScreen.tsx` + `poseFrameSource.ts`). These unknowns can expand scope and must be settled before building the screen.
- **C2 — Build the results screen:** an async screen that takes an `assessmentId`, authenticates, fetches `GET /api/assessments/[id]` (the enriched findings with `*_muscle_links`), and renders summary + a per-finding list (port a minimal RN version of the web finding cards). Add minimal navigation (capture → processing → results) — `expo-router` or `@react-navigation` (new dep) since there's no navigator today.
- **C3 — Mobile 3D card `MuscleModel3DWebView`:** `react-native-webview` loading the deployed `https://<web>/muscle-viewer/index.html?embed=1`; wait for the viewer's `ready` via the WebView `onMessage` bridge, then `injectJavaScript(\`window.muscleViewer.applyMuscleStates(${JSON.stringify(states)}); true;\`)` — **template-literal form** (a string argument would iterate characters and color nothing). Re-inject on `states` change. Reuse the shared adapter (drive from the fetched enriched findings). Placement: aggregate card above the findings list.
- **C4 — Web/Expo-Go fallback + native build:** gate the WebView so `react-native-web` / Expo Go fall back to a 2D/text view (webview is a native module). Add a **custom dev client / EAS build** (new `eas.json`) — not Expo Go, not OTA.

---

## Verification (end-to-end)

- **Unit** `findingsToMuscleStates.test.ts` (node vitest): unreliable-skip (regression guard for the `reliable` no-op), links path + severity threading, **legacy fallback**, severity sanitization (`null`/`NaN`/`150`/`-20`/`"80"`), dedup max-severity, tight/weak conflict → tight-on-tie + `collapsedConflicts`, immutability, `notShown`, genu both-links.
- **Coverage guardrail** `muscleCoverage.test.ts`: every posture-ai content slug (29) resolves to a viewer id via `muscleIds.generated.json` or is in an (empty) `KNOWN_UNMAPPED` allowlist; fail on a new unmapped slug.
- **Web E2E** `e2e/muscle-3d.spec.ts` (Playwright, reuse the fixture flow): assert the card renders and **no** `/muscle-viewer/model.glb` request before click (proves click-only); after click, assert `/muscle-viewer/index.html` + `model.glb` are 200 and the index CSP contains `frame-ancestors 'self'`; **real-render** via `frameLocator` (viewer root attached, no CSP frame-violation in console); **applied-coloring** via `frame.evaluate(() => window.muscleViewer.getAssessment())` asserting expected red/blue `muscle:side` keys.
- **Mobile:** component test of the shared adapter (same as unit); manual smoke on a dev client — results screen loads a real assessment, 3D card colors match the fetched findings; Expo-Go/web fallback renders 2D.
- **Manual:** same muscles red/blue in 3D as in the 2D maps (identity, not hex); higher `severity_pct` → visibly stronger shade; unreliable finding → no color; forced GLB 404 leaves the page intact.

## Sequencing / rollout

1. Workstream 1 (viewer) + the shared adapter — unblocks everything.
2. Workstream 2 (web) — ship-ready on its own; the primary deliverable.
3. Workstream 3 (mobile) — gated behind C1 prerequisites; largest and least-certain. Treat C1→C2 as its own reviewable chunk before C3/C4.

## Residual risks & deferred (honest)

- **Mobile auth/API/submission (C1)** is the biggest unknown and may expand mobile scope beyond the 3D itself.
- **Genu direction-gating** deferred (shared API+2D+3D change; v1 mirrors current over-coloring).
- **Laterality** deferred (bilateral, matches 2D; when added, dedup moves to `slug:side`).
- **Meshopt** (9.15 MB → ~1.7 MB) now higher-priority for mobile-over-network; needs on-device decoder validation (viewer docs note it "did not decode in the dev-preview sandbox").
- **Committed build bloat** (~10.4 MB/rebuild) accepted for v1 (click-mount + immutable hashed cache + CI guards); object-storage GLB is the escalation.
- **Same-origin iframe is not a security boundary** — fine for first-party code we build; separate-origin + `sandbox` if the viewer ever becomes less-trusted.
- **Manual `sync:muscle-viewer`** — mitigated by the two CI guards, not a full CI rebuild.
- **tight/weak conflict** collapses to one color (surfaced via `collapsedConflicts` note).

## Notes

- GPT-5.5 headless verifier command (subscription OAuth, no per-token cost): `codex exec --skip-git-repo-check -m gpt-5.5 -c sandbox_mode=read-only -c approval_policy=never "<prompt>" </dev/null`.
- Detailed, source-cited spec (all §§ referenced above): `scratchpad/final_design_v3.md`.
