# Array v3 UI redesign — execution plan (2026-10-07)

Goal: a clear, legible, snappy, glassy, spring-driven mobile app with one type
system, one spacing scale and one shared component library. The 3D posture map
and scan animation are unchanged.

Inputs: measured UI audit (74 screenshots, per-element contrast/target data), a
HIG / Material 3 / WCAG 2.2 brief, a full redesign proposal from Sonnet 5.5
(→ `docs/design/array-v3-spec.md`), an independent critique from Kimi K3, and the
coordinator's decisions. Contract: `DESIGN.md` (v3).

## Batches (each lands through CI, then deploys to Vercel production)

| Batch | Scope | Review |
|---|---|---|
| **1 — Foundation** | v3 tokens in `app/globals.css` (v2 names aliased), type-role rename across screens, `lib/motion.ts` springs, `lib/haptics.ts`, `components/ui/*` (Button, IconButton, fields, Segmented/Tabs, Switch/Checkbox, loader family, Surface v3, Card, ListRow, chips/badges, SeverityChip, Sheet, Dialog, Toast, Banner, Empty/ErrorState, Stat, Readout, Stepper), shell (docked labelled TabBar with raised Capture, TopBar, ActionBar + `--chrome-bottom`, AmbientField v3, single `<main>` + skip link, RouteProgress), `/dev/kit` gallery | Greptile #1, Kimi K3 |
| **2 — Core journey** | Today, Clients, Client detail, Capture wizard chrome + processing loader, Results (everything except the 3D map; one stylesheet; severity once; finding Sheet) | Greptile #2, Kimi K3 |
| **3 — Everything else + cleanup** | Workouts hub (Saved · Builder · Library), Exercises, Muscles, manual routines, workout player, Train, Share `/s/[token]`, Consent, You/Settings, Auth, Onboarding, Legal, Landing; delete IslandNav, legacy sheets and `.a-*` recipes; tighten lint/budgets | Kimi K3 |

## Proof per batch

- Unit: `npx vitest run` green; component ARIA contracts tested.
- E2E: Playwright suites green in CI (main + 3D jobs); a11y budget serious/critical = 0.
- Audit sweep (the audit script) on the batch's routes at 390×844 and 360×780:
  0 contrast failures, no target < 44px outside documented exceptions, no
  horizontal overflow, nothing occluded by fixed chrome, ≤ 2 blur layers.
- Screenshots reviewed by the coordinator before landing.
- After landing: Vercel production deploy, smoke check of the live URL.

## Decisions

See `docs/design/array-v3-spec.md` › "Decisions taken on the proposal's open
questions". Physical-device check of the camera chrome is the owner's after deploy.
