# Task 8 Report: Red-flag Pre-session Screen

## Migration

**File:** `supabase/migrations/20260707020000_session_runs_red_flag.sql`

Timestamp corrected per Correction A (20260707010000 already taken). Applied via `supabase migration up`.

**psql verification:**
```
 red_flag_acknowledged | boolean                  |           |          |
```
Column exists, nullable, no default — older runs stay NULL.

## WorkoutPlayer gate (`app/workouts/_player/WorkoutPlayer.tsx`)

Added `redFlag: 'unasked' | 'clear' | 'stopped'` state (default `'unasked'`) at line ~96 (after the existing `captionsOn` state).

**How `begin()` is gated:** `begin()` (line ~230) now starts with `if (redFlag !== 'clear') return`. This is a hard guard — even if somehow reached while `redFlag` is still `'unasked'` or `'stopped'`, it no-ops immediately.

**Render logic** (lines ~309–329) — the `idle/intro` AnimatePresence branch was split into three keyed cases:
1. `redFlag === 'unasked'` → renders `RedFlagCard` with the exact copy: _"Before you start — are you feeling any sharp or worsening pain right now?"_ / "No, I feel okay" / "Yes"
2. `redFlag === 'stopped'` → renders `StopCard` with _"Let's pause here. Sharp pain is worth checking with a movement professional before continuing."_ and a single "End session" dismiss button that calls `onExit`
3. `redFlag === 'clear'` → renders the original `StartCard` (onBegin={begin})

`StartCard` and therefore `begin()` are never rendered until `redFlag === 'clear'`.

**`onRedFlagClear` handler** (added alongside `begin`): calls `setRedFlag('clear')` then `saveRun?.({ red_flag_acknowledged: true })`. The `?.` skips the call when `saveRun` is undefined (none of the current paths pass null, but the prop is optional). On the share-token path, `saveRun` writes to localStorage and silently drops the `red_flag_acknowledged` key (its serializer only extracts `index`/`items`/`revision`).

## Flag persistence through `buildRunUpdate` (`lib/workout/runState.ts`)

Added `red_flag_acknowledged?: boolean` to `RunPatch`, `red_flag_acknowledged?: boolean | null` to `RunRow` and `RunUpdate`.

In `buildRunUpdate`, the flag is threaded as:
```ts
const red_flag_acknowledged =
  patch.red_flag_acknowledged === true ? true : existing.red_flag_acknowledged ?? null
```

- Once `true`, it stays `true` on all subsequent patches (acknowledged cannot be un-acknowledged).
- A patch with no flag leaves the DB value unchanged.
- A red-flag-only patch (`{ red_flag_acknowledged: true }` with no `revision`) bypasses the revisioned-stale gate (that gate only fires when `patch.revision != null`), so the flag persists correctly.

**Route changes (`app/api/workouts/[id]/run/route.ts`):**
- Added `red_flag_acknowledged: z.boolean().optional()` to `bodySchema` (strict schema — field must be declared explicitly).
- Added `red_flag_acknowledged` to the `select(...)` columns so `buildRunUpdate` receives the existing value from the DB.

## runState unit tests

3 new tests added to `lib/workout/runState.test.ts` in a new `describe` block:
1. _"a patch carrying red_flag_acknowledged persists it regardless of other fields"_ — a bare `{ red_flag_acknowledged: true }` patch writes the flag.
2. _"red_flag_acknowledged remains true when a subsequent patch omits it"_ — the flag is preserved when not re-sent.
3. _"red_flag_acknowledged is null when neither the patch nor the row carries it"_ — no false-positive writes.

**Result:** 14/14 tests pass (11 pre-existing + 3 new).

## E2E assertions + result

**File:** `e2e/workout-player.spec.ts`

Two flows, both chromium-only (player UI test):

**Flow 1** (`flow 1: red-flag question renders before player controls, "No, I feel okay" unblocks begin, session starts`):
- Mints a session, navigates to `/workouts/${sessionId}`
- Asserts the question text is visible before any player controls
- Asserts `data-testid="red-flag-no"` and `data-testid="red-flag-yes"` are visible
- Clicks `[data-testid="red-flag-no"]`
- Asserts "Begin session" button appears (StartCard rendered)
- Asserts the question text is gone
- Clicks "Begin session"
- Asserts `/up next/i` text appears (player is in the upNext phase — session has started)

**Flow 2** (`flow 2: "Yes" shows the stop card and no player timeline appears`):
- Mints a fresh session, navigates to the player
- Clicks `[data-testid="red-flag-yes"]`
- Asserts `data-testid="stop-card"` is visible
- Asserts "Let's pause here" and "movement professional" text are visible
- Asserts "up next" text is NOT visible
- Asserts "Begin session" button is NOT visible

**Result:** 3 passed (setup + 2 flows) in 11.4s. No pre-existing flake observed.

## Gate results

| Gate | Result |
|---|---|
| `npm run typecheck` | Clean (0 errors) |
| `npm run lint:vocab` | 124/124 |
| runState unit tests | 14/14 |
| e2e workout-player spec | 3/3 passed |
