# Mobile testing checkpoint

The owner requested a stable stopping point and production mobile testing on September 9, 2026. Feature expansion is paused. This checkpoint integrates the original application's screening presentation, 280-reference exercise library, saved manual routines, strength/conditioning programs, logging, progression, coaching, and offline handling.

## Testing path

Use the original application at https://posture-ai-ivory.vercel.app after the release receipt confirms the new deployment. Sign in with the existing account. Visit Exercises, build a manual routine, save it, reopen it, and follow its player. Use Workouts to try the explicitly labelled sample program. Review an existing assessment's retained photos and interactive anatomy view. Test portrait and landscape on the phone.

## Verified and preserved

- The 29 production migrations from 54000 through 69500 match the clean-install snapshot byte for byte. All are applied. Before/after production counts remain 12 clients, 12 assessments, and zero training subjects; no synthetic users were seeded into production.
- Final routine account-switch controls are locked until remount; exact uncertain retries and same-tick submissions preserve one attempt. Focused regression tests pass.
- Recent local proof includes Chromium/WebKit routine retry and fresh-context playback, responsive long-name layouts, media fallback, permission denial, and full coach/athlete sample handoff. Physical-phone usability remains for the owner to test.
- Local proof artifacts and isolated stacks are preserved under ignored `work/`; no secrets or runtime artifacts belong in the release commit.

## Explicit remaining work

- Reviewed live exercise/program eligibility and qualified exact exercise media remain incomplete. The reference library and labelled synthetic sample program do not establish those approvals.
- `e2e/training-offline-lifecycle.pending.ts` is outside discovery: its fixture needs exact athlete JWT claims for lifecycle verification. The failed local run rolled back its assignment transition. No application defect was established by that failure.
- Seven other browser specs require the dedicated API 55421 / DB 55422 fixture stack. They run when that exact API is supplied and are excluded from ordinary CI's different database target. Retained local passes are not represented as CI passes.
- Remaining PRD criteria, physical-device checks, human usability, scan validity, and qualified content reviews remain in the existing requirement/evidence ledgers. This is a testing checkpoint, not completion of the full PRD.

Release identity and provider receipts are retained under `work/proof/` and the canonical goal proof directory. A successful build or health response alone does not establish which commit the public URL serves.
