# Stopping point — 2026-10-08

Posture AI was wrapped up at Devin's request partway through the production QA loop
(Loop Library 010 via `/goal`, spec `~/.claude/goal-state/posture-ai-production-qa/spec.md`).

## Production

- Serving `784cffadf4ff0110333893340ee543da130d1bd6` (PR #165, Array v4) as
  `dpl_FBSuTFxGATy9xJhguppKm4NF7SLU` on `posture-ai-ivory.vercel.app`. Release used the
  RUNBOOK exact-revision procedure. The alias was verified, and `/api/health` returned ok
  on 2026-10-08.
- `main` is ahead at `3977a9a`. PR #166 and PR #167 are merged but **not released**.
- PR #167 adds migration `supabase/migrations/20261008000000_archived_client_write_guards.sql`.
  Applying it to the production database (RUNBOOK › Migrations step 3) needs Devin's
  approval. The route-level checks in #167 do not depend on it.
- Clinical content is live in production (`clinical_content_gate_removed`, #157).

## What landed today

| PR | What |
|---|---|
| #165 | Array v4 "Kinetic Instrument" redesign. Pre-existing fixes included: offline drain retry waits only for the remaining lease, sign-out waits for the offline queue clear, Sheet leaves Escape to nested dialogs, a single navigation per sign-out. |
| #166 | QA-021: MFA accounts complete password recovery through a TOTP step-up. `safeNextPath` rejects control characters and backslashes. |
| #167 | QA-022/023: no new capture, image, share, consent-link or report writes for archived clients. Withdrawal, revocation, erasure and unarchive still work. |

## Work in progress (pushed, not merged)

- `wip/2026-10-08-production-qa` contains:
  - the PASS-09 report and audit dispositions;
  - the v4 inventory (76 items, every route);
  - BUGLOG entries QA-021 to QA-038;
  - a fix so `scripts/qa-seed.ts` resolves the local stack from `supabase status` (it used to be hard-coded to 54321/54322, which belong to another project);
  - `qa-loop` rule 5 updated for exact-revision releases.

  None of this has been through CI. Open a PR and land it with `zs-land`.
- PASS-10, the closing rerun, was stopped before it recorded any results.

## Open QA items

- **S2 QA-020** (needs Devin and a clinician): genu varum and valgum share direction-specific
  muscle and program links. Visible in production.
- **Legal text** (needs Devin and counsel): the `LEGAL_DOCUMENTS` catalog in
  `content/legal/documents.ts` is empty, so practitioners stop at
  `/onboarding?reason=legal_unavailable`. Local signed-in QA needs `POSTURE_TEST_MODE_ENABLED=1`
  for fixture text.
- **S3:**
  - QA-024 invalid or future date of birth
  - QA-025 CSP blocks a script
  - QA-026 no-WebGL map spinner
  - QA-027 320px/200% header overflow
  - QA-028 photo load flake
  - QA-029 foreign/missing record pages return 200
  - QA-031 raw error text
  - QA-036 first name on the public share page (Devin decision)
  - QA-037 erasure takes more than 30 s
  - QA-038 in-person consent leaves the remote link live
- **S4:** QA-030, QA-032, QA-033, QA-034, QA-035.
- **Carry-over:** `~/Inbox/notes/posture-v4/qa-carryover.md`. Includes the offline replay
  overlap, the sign-out clear not bound to a user ID, the sign-out dialog copy question,
  and the no-sensor message decision.
- Each UI release changes the clinical inventory hash. That invalidates saved-workout
  catalog identity, so saved workouts show "This plan needs a current copy". This is
  existing behaviour and Devin should decide whether to keep it.

## Local environment notes

- `supabase/config.toml` was changed locally to ports 55320–55329 and marked
  `skip-worktree` in the QA and v4 worktrees. Both were restored to the committed file.
  The 553xx copy is at `~/Inbox/notes/handoffs/posture-v4-local/config.toml.posture-553xx`.
  On this machine, meal-companion owns 54321/54322 and another project uses 56321–56327.
- The local posture-ai Supabase stack is stopped, with data kept in its Docker volume.
  No dev servers are running.
- posture-ai keeps a built copy of the separate muscle-viewer project in `public/muscle-viewer/`
  (8 tracked files, including `model.glb`), along with `app/assessments/[id]/muscleIds.generated.json`
  and `docs/qa/muscle-viewer-build.json`. These are refreshed by `npm run sync:muscle-viewer`,
  which reads `../muscle-viewer`. They were left unchanged. Do not modify `~/projects/muscle-viewer`
  or its worktrees from this repo.

## Resume

```bash
cd ~/projects/posture-ai && git fetch origin
git worktree add ~/projects/posture-ai-wt/qa-resume wip/2026-10-08-production-qa
cd ~/projects/posture-ai-wt/qa-resume && npm ci
cp ~/Inbox/notes/handoffs/posture-v4-local/config.toml.posture-553xx supabase/config.toml
git update-index --skip-worktree supabase/config.toml
npx supabase start
# .env.local: NEXT_PUBLIC_SUPABASE_URL/ANON_KEY/SERVICE_ROLE_KEY from `npx supabase status -o env`
# (loopback only), NEXT_PUBLIC_SITE_URL=http://127.0.0.1:3100; test-mode vars unset
npx supabase db reset && npm run qa:preflight && npm run qa:seed
npm run build && POSTURE_TEST_MODE_ENABLED=1 npx next start -p 3100 -H 127.0.0.1
# then: /goal --resume posture-ai-production-qa   (current task t5, PASS-10)
```

Also needs a decision: release `main` (3977a9a) with the RUNBOOK exact-revision procedure,
and apply the #167 migration once Devin approves it.
