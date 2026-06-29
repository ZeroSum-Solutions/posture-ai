# End-to-end tests (Playwright)

E2E suite for posture-ai. Runs against `next dev` backed by the **local Supabase
stack**, across two projects: `desktop-chromium` and `mobile-webkit`.

## Prerequisites

1. **Local Supabase stack up** — `npx supabase start` (Docker). The first start applies
   all migrations + the muscle-KB seed. If the schema/seed changed, or the stack was
   already running, rebuild it: `npx supabase db reset`.
2. **Playwright browsers** — `npx playwright install chromium webkit` (once).

`scripts/run-e2e.mjs` resolves the running stack's URL/keys into `E2E_*` env vars and
copies the self-hosted MediaPipe WASM before invoking Playwright; it fails fast with a
clear message if the stack is down.

## Running

```bash
npm run test:e2e                              # full suite, both projects
npm run test:e2e -- e2e/muscle-kb.spec.ts     # one spec
npm run test:e2e -- --project=desktop-chromium
npm run test:e2e -- --project=mobile-webkit
npm run test:e2e -- --headed --debug          # debug a failure

# Reproduce CI locally (clean stack + retries:1 + HTML reporter + fresh server):
npx supabase db reset && CI=1 npm run test:e2e
npx playwright show-report                     # opens the CI=1 HTML report
```

Local runs use the `list` reporter and `retries: 0`, so flake surfaces as a failure.
`CI=1` switches to `retries: 1`, `forbidOnly`, the HTML reporter, and forbids server
reuse — so a plain local run is **not** an exact CI repro; `db reset` + `CI=1` is.

The dev server runs on port **3100** (`E2E_PORT` to override). Locally Playwright
**reuses** an existing server on 3100, so a stray `next dev` there can serve stale code
or run without test mode — kill it (`lsof -ti tcp:3100 | xargs kill`) or set `E2E_PORT`.

## Project matrix

| Project | Device | Runs |
|---|---|---|
| `setup` | — | `auth.setup.ts` → authenticated session (`e2e/.auth/user.json`); a dependency of both projects |
| `desktop-chromium` | Desktop Chrome | all specs |
| `mobile-webkit` | iPhone 14 | all specs **except** `real-detection` + `capture-errors` (camera/model tests; `testIgnore`) |

Intentional, legitimate skips (do **not** remove to force green): `a11y.spec.ts`
`test.skip`s off non-chromium; `mobile-webkit` `testIgnore`s `real-detection` /
`capture-errors`. "Green on both projects" = the chromium superset **plus** the
mobile-webkit subset, not an identical run.

## Specs

| Spec | Covers | Projects |
|---|---|---|
| `auth.setup.ts` | sign-in → saved session | setup |
| `assessment-flow.spec.ts` | golden path (test mode) → 10 findings + PDF; client-required guard | both |
| `auth-access.spec.ts` | unauthenticated `/dashboard` + `/clients` → sign-in | both |
| `clients.spec.ts` | client list/search; archive; detail empty-state; create form (consent gate); edit | both |
| `health.spec.ts` | `GET /api/health` → ok / connected / schema ready | both |
| `logout.spec.ts` | NavBar logout → cleared session (restores shared session in `afterEach`) | both |
| `muscle-kb.spec.ts` | finding → muscle page → exercises; muscle library + search | both |
| `unreviewed-content.spec.ts` | "Pending review" badge on an unreviewed muscle (dev/preview) | both |
| `wizard-nav.spec.ts` | wizard back-navigation; abandon mid-wizard | both |
| `real-detection.spec.ts` | real photo upload → MediaPipe → score; no-CDN assertion | chromium |
| `capture-errors.spec.ts` | camera permission denied; no-orientation-sensor; no-person upload | chromium |
| `a11y.spec.ts` | zero serious/critical axe violations | chromium |

## Test mode

The wizard's golden path runs in **test mode** (`/assessments/new?testMode=1`), which
injects fixture landmarks instead of running MediaPipe. The client `?testMode=1` param
is inert without the **server** gate `POSTURE_TEST_MODE_ENABLED=1` (set only by the
runner/CI — **never in production**, where the server returns `400`). `/api/dev/*` must
stay unreachable in production.

## Adding a spec

- One concern per file under `e2e/`, with a top-of-file comment explaining *why* it
  exists and any project restrictions.
- Reuse `helpers.ts` (`createClient`, `selectClientInWizard`); extend it rather than
  duplicating setup.
- The suite is **serial** (`workers: 1`) and shares one practitioner account. Give every
  created client a **fully-unique** name — `crypto.randomUUID().slice(0, 8)`, not a
  truncated `Date.now()` (which can collide and alias name selectors).
- Prefer role / test-id locators and explicit waits (`waitForURL`) over sleeps.
- Run `npm run lint && npm run typecheck` before committing: `tsconfig.json` includes
  `e2e/`, so a type/lint error in a spec reds CI even when the Playwright run is green.

## Flake policy

Flake is a bug — fix the cause, never mask it (no added `test.skip` / `fixme`, loosened
matchers, inflated timeouts, or `retries` as a crutch; `retries` stays `CI ? 1 : 0`).
Known traps:

- **Stale local seed / stray `:3100` server** — `npx supabase db reset` and clear 3100
  before a clean run; a stale seed is the usual cause of count-mismatch failures
  (e.g. `muscle-kb`).
- **Shared practitioner account + serial run** — unique client names, and `db reset`
  between full runs so name selectors don't alias to the wrong row.
- **Global sign-out poisons the shared session** — the app's `signOut()` is global
  scope, and GoTrue revokes the shared session immediately (not at JWT expiry).
  `logout.spec.ts` re-signs-in and re-saves `e2e/.auth/user.json` in `afterEach` so a
  logout never cascades into later specs.
- **WebKit client-side `getUser` race** — chaining `/clients` → `/clients/[id]`
  navigations quickly can abort the detail page's `getUser` fetch ("Load failed") and
  bounce to sign-in. Assert client data via `page.request` API calls, or use a single
  clean `goto`.
