# QA Loop — Iteration 1 (PASS-01) — COMPLETE

**Started:** 2026-07-04 · **Commit at start:** `c4aa299` (main) · **Verdict:** **BLOCKED-HANDOFF**

## Verdict summary
Phases 0–2 complete (full inventory driven). Phase 3: the top found-bug cluster (QA-001)
fixed + landed with a passing e2e regression; remaining clusters handed off. **Not a CLEAN
PASS** — and cannot be, autonomously: several inventory items are inherently BLOCKED without a
physical device (CAM-REAL, WIZ-02/03 real capture, CON-04 live capture gate, WKT-03 in-player
media), and the deep-audit surfaced 6 more S2/S3 clusters that are legitimate follow-up branches.
Zero open **S1**. Open **S2**: only the AUDIT-sourced clusters (none newly found at runtime —
all found-at-runtime bugs are S3/S4). Found this pass: QA-001 (S3, **FIXED**), QA-002 (S3, open),
QA-003 (S4, open). All security/data-integrity gates hold at runtime.

### Phase 3 — landed
- **QA-001 (S3) FIXED** on branch `fix/qa-001-erased-client-read-paths`: `.is('deleted_at', null)`
  added to /clients list, dashboard count, wizard picker; recent-activity → `clients!inner` +
  `.is('clients.deleted_at', null)`. Verified in rebuilt prod bundle (all 4 read paths → 28, no
  Beth/Carl) + e2e regression `e2e/clients.spec.ts` green (8 clients/deletion tests pass) + typecheck clean.

### Phase 3 — HANDOFF (remaining clusters, ranked; one branch each)
1. **Consent-token hashing (S2 security, AUDIT Area 3):** consent_tokens.token stored plaintext
   (`consent/link/route.ts:34`) — hash SHA-256 like the workout token. TOP priority.
2. **QA-002 (S3):** muscle content-gate graceful degradation — empty-state copy + suppress dead
   `/muscles/[slug]` links from results when target unreviewed (prod ships an empty Muscle Guide + 404 links).
3. **Unbounded client-list queries (S2, AUDIT Area 5):** add `.limit()` + server-side `?search=`
   to the same three client-list queries QA-001 touched, plus `clients/[id]/assessments`.
4. **WorkoutPlayer correctness (S2, AUDIT Areas 2/5/9):** fix `react-hooks/set-state-in-effect`
   lint ERROR (`WorkoutPlayer.tsx:397`), replace raw `<img>`, consume `useWakeLock`, iOS speak() prime.
5. **Assessment-page altitude (S2, AUDIT Area 1):** `assessments/[id]` server-component split + SessionSnapshot version guard.
6. **QA-003 (S4):** results-page SWAP/capability `<select>`s lack id/name — add ids + a11y regression.
7. **Camera manual pass (CAM-REAL + WIZ-02/03 + CON-04 + WKT-02/03 live):** on-device iOS Safari + Android Chrome.

### e2e-harness note (important for Phase 4 / CI)
`playwright.config.ts` webServer is `reuseExistingServer:true` on **:3100** — the SAME port this
QA workflow runs the `next start` prod server on. If the prod server is up, Playwright reuses it
(prod bundle: dev-only `create-test-user` 403s → auth.setup fails "Invalid login credentials").
**Run e2e with :3100 FREE** so Playwright starts its own `next dev`. With that, auth.setup + specs pass.

---


Resume-safe state file. Update as phases complete. Prior state: earlier ad-hoc
QA effort (`_archive/pass-1-resolution.md`, 2026-06-29, 20 BUG-fixes, clean) predates the
formal skills; this is iteration 1 under `.claude/skills/qa-loop`. Deep-audit
(`docs/qa/AUDIT.md`) done first — PROVED findings feed Phase 3 clusters.

## Guardrails confirmed
- ✅ `NEXT_PUBLIC_SUPABASE_URL` = local `127.0.0.1` (verified at runtime, value not exposed). Production `dhrkezfypzutiwtmcmof` NOT touched.
- Synthetic data only (`qa+*@example.test`, engine fixture landmarks).

## Phase 0 — environment ✅ COMPLETE
- ✅ `npx supabase start` — local stack up (DB `127.0.0.1:54322`, API `:54321`).
- ✅ `npx supabase db reset` — all 24 migrations applied clean (exit 0; NOTICEs are idempotent drop-if-exists guards).
- ✅ `scripts/qa-seed.ts` authored (reuses `assessPosture`+`buildFindingRow`); run via `npm run qa:seed`; **idempotent** (identical counts on rerun). Accounts: `qa+prac-{empty,typical,heavy}@example.test` / `TestPass1234!`.
- ✅ `POSTURE_TEST_MODE_ENABLED=1 next start -p 3100` against prod build; `/api/health` = 200 (db connected, schema ready); sign-in all 3 accounts = 200+token.

**Seed counts:** 3 practitioners (empty/typical=21 clients/heavy=150); 171 active + 9 tombstoned clients; 240 assessments (95 draft, 145 approved) over 6 months, 2400 findings, 480 captures (storage_path NULL); consents 152 granted / 10 revoked; consent tokens 7 pending / 5 expired; workout sessions 46 active / 29 completed / 4 revoked; session_runs 17 in_progress / 29 completed; 17 ratings; share events 23 minted / 4 revoked.
_Note: ~240 assessments vs skill's ~400 target — sufficient (heavy account + 6-mo multi-assessment history present). Reseed with more only if a trend view needs denser data._

Schema notes from seeding: `captures_no_image_bytes` CHECK forces storage_path NULL; `program_snapshot` JSONB rejects image-ish keys; workout token stored as SHA-256 hash only; tombstone-reject triggers require assessments/sessions inserted BEFORE client tombstone; auth.users deletion needs app tables truncated first (assessments.practitioner_id not CASCADE).

## Phase 1 — inventory
- ✅ `INVENTORY.md` pre-seeded w/ acceptance criteria + edge cases for ~35 items; matches live route tree (21 pages / 22 routes). `CAM-REAL` = BLOCKED(manual device).

## Phase 2 — test (chrome-devtools MCP, mobile 390×844) — IN PROGRESS (~13/35 items touched)
Browser: chrome-devtools MCP (had to `pkill -f chrome-devtools-mcp/chrome-profile` + rm SingletonLock — stale instance held the profile lock; relaunches clean). Viewport 390×844. Testing as `qa+prac-typical`.

Done so far:
- AUTH-02 PASS (invalid→generic error no-enum, valid→dashboard)
- AUTH-05 PASS (anon GET+POST all API → 307 /auth/sign-in, no 500/leak)
- MSC-01 PASS (root anon→sign-in; authed→dashboard)
- MSC-02 **FAIL(QA-001)** (Total Clients 30, should be 28 — counts 2 tombstoned)
- CLI-01 **FAIL(QA-001)** (list includes tombstoned Beth/Carl Smith)
- CON-03 PARTIAL (garbage token clean 200 not-found, no leak; grant/decline+valid/expired untested)
- SHR-01 PARTIAL (garbage: API 404 uniform, /s page clean; mint/valid/expired/revoked/tombstone untested)
- RES-01 PASS (all 10 distortions, grade, unreliable-not-scored, screening vocab, 3D gated, 0 console errors)
- CLI-03 PARTIAL (cross-tenant PASS: heavy's client→redirect /clients, heavy's assessment→"not found", no leak)
- REP-01 PARTIAL (approved→200 signed_url scoped {practitioner_id}/{assessment_id})
- REP-02 PASS (PHI boundary server-enforced: cross-client→400 "must belong to same client"; same-client→200)
- WKT-01 PASS (mint gate: unapproved→403 "Approve the assessment before launching"; approved→200 session_id)
- WKT-02 PARTIAL (intro renders 15 movements/~23min/disclaimer/Begin, 0 console errors; deep mechanics untested)

**Security gates confirmed at runtime (all hold, matching AUDIT):** route protection (anon→307), cross-tenant deny (no leak), PHI comparison boundary (same-client only), workout-mint approval gate. Only defect so far = QA-001 (S3 tombstone filtering).

**S4 note RETRACTED:** the earlier concern that `/s/[token]` and `/consent/[token]` show practitioner nav to anon was a false alarm — observed only because the tester's own session cookie was present. Verified in a **cookie-isolated** context: anon visitor sees NO practitioner nav (hamburger reveals nothing); both pages render correctly redacted. Not a bug.

### Batch 2 (API-edge + anon-context, session 2026-07-04 resume):
- CON-02 PASS (mint `/api/consent/link` → 200: `/consent/[uuid]` URL + QR data-uri + `expires_at` +7d)
- CON-03 PASS (valid token anon: BIPA-safe copy, guardian/minor roles, signature gate; grant→"Consent recorded"; **idempotent** — 2nd submit→422 "already been used", no flip; garbage→uniform 404). Minor S4 UX nit: GET re-renders sign form on a consumed token instead of an upfront "already used" state — server enforces it, cosmetic only, no branch.
- SHR-01 PASS (mint `share:true`→200 share_link; valid token resolve→200 **redacted projection**: only `clientFirstName`+`snapshot`+`expiresAt`, zero internal ids; 2 garbage tokens→uniform 404 "not available"; anon `/s/` page redacted, no nav leak)
- WIZ-04 (edge) PASS (garbage `POST /api/assessments`→422 zod "Invalid payload: client_id"; no 500)
- REP-01 (edge) PASS (unapproved `POST /api/reports`→403 "must be reviewed and approved before exported")
- WKT-05 PASS (run PATCH advance→200; replay same revision→200 `{ok,stale:true}` NO double-advance; nonexistent/cross-tenant session→404 "Session run not found")
- WKT-06 PASS (rate banned clinical terms in notes→422 "remove clinical terms"; clean rating→200; upsert one-per-run)

REMAINING (~15 items): AUTH-01/03/04/06, CLI-02/03(own-detail)/04/05, CON-01/04, WIZ-01/02/03, WKT-02(deep)/03/04, SHR-02, RES-02/03/04, KB-01/02, PRG-01, SET-01, MSC-01(legal pages), XC-01..04. CAM-REAL stays BLOCKED (device). Do NOT fix mid-pass.

## Phase 2 — COMPLETE
Full inventory driven top-to-bottom at 390×844 (API-edge probes + UI flows + anon-context). Every
non-camera item reached a verdict; camera-path items marked BLOCKED(device). See INVENTORY.md Pass-1
column. 3 bugs found (QA-001/002/003); all security/data-integrity gates hold.

## Phase 3 — fix clusters — QA-001 landed, rest handed off
- ✅ QA-001 (S3) fixed + e2e-verified on `fix/qa-001-erased-client-read-paths` (see Verdict summary).
- ⏭ Remaining 6 clusters handed off (see HANDOFF list above) — ranked, one branch each.

## Phase 4 — rerun + verdict — BLOCKED-HANDOFF
- QA-001 re-verified fixed across all 4 read paths in the rebuilt prod bundle + e2e green.
- CLEAN PASS unreachable autonomously (camera items BLOCKED + open S2 audit clusters). Verdict: **BLOCKED-HANDOFF** (iteration 1 of hard-cap 4).

## Bugs this pass
- **QA-001** (S3, **FIXED**): erased/tombstoned clients (deleted_at) listed + counted + in wizard picker + recent activity. Fixed across 4 read paths + e2e regression. See BUGLOG.
- **QA-002** (S3, open): prod muscle content-gate → empty Muscle Guide + 404 detail pages + dead result→muscle links (0/29 reviewed). Graceful-degradation code fix + content-review. See BUGLOG.
- **QA-003** (S4, open): results-page SWAP/capability `<select>`s lack id/name (13). Minor a11y. See BUGLOG.

## RESUME INSTRUCTIONS (for next window)
Env may be down after compaction. To resume:
1. `cd ~/projects/posture-ai`; ensure local supabase up (`npx supabase status`; `npx supabase start` if stopped). Data persists unless the stack was reset — if empty, `npm run qa:seed`.
2. Start server: `POSTURE_TEST_MODE_ENABLED=1 npx next start -p 3100` (build exists; `npx next build` first if `.next` missing). Smoke `curl 127.0.0.1:3100/api/health`.
3. chrome-devtools MCP: if "browser already running" error, `pkill -f chrome-devtools-mcp/chrome-profile` + `rm ~/.cache/chrome-devtools-mcp/chrome-profile/SingletonLock`.
4. Continue Phase 2 from REMAINING list above (mobile 390×844). Log FAILs to BUGLOG. Accounts: qa+prac-{empty,typical,heavy}@example.test / TestPass1234!.
5. After Phase 2 done: Phase 3 cluster fixes (QA-001 + any new + PROVED audit findings), one root-cause branch each, TDD, `~/bin/zs-land`; Phase 4 reseed+rerun full inventory; finalize verdict here.
