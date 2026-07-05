# Red-Flag Integrity Cluster Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the red-flag pre-session safety screen real end-to-end: re-asked on every resume, enforced server-side at completion, and visible to the practitioner.

**Architecture:** The gate currently lives only in `WorkoutPlayer` render conditions tied to phase `idle`/`intro`, so `resumePlayer` (which enters `upNext`) skips it and the TICK clock auto-plays. This plan lifts the gate above the phase machine (redFlag state gates *rendering and the clock*, not just `begin()`), makes every client patch carry the acknowledgement once cleared, rejects run *completion* server-side when the acknowledgement is absent, and adds a small practitioner-facing run list on the assessment page. No schema change — `session_runs.red_flag_acknowledged` already exists (migration `20260707020000`).

**Tech Stack:** Next.js 16 App Router, React 19, Zod, Supabase (service-role writes scoped by `practitioner_id`), Vitest, Playwright.

**Decision record (Devin, 2026-07-05):** Full integrity cluster chosen over UI-only re-prompt. Audit evidence: `docs/qa/AUDIT.md` §Delta re-audit 2026-07-05 (resume auto-play S2, server non-enforcement S2, no practitioner surface S3).

## Global Constraints

- Screening vocabulary ban in ALL user-visible copy: no stems `diagnos`, `treat`, `cure`, `patient`, `prescri` (enforced by `lib/ui-vocabulary.test.ts`).
- Local Supabase only (`supabase status` must show 127.0.0.1). Never touch prod project `dhrkezfypzutiwtmcmof`.
- No new migrations needed; if any schema change becomes necessary, forward-only, next free timestamp after `20260707030000`.
- One feature branch for the whole cluster → land via `~/bin/zs-land`. Never commit to main.
- Match existing code style (inline style objects, comment density as in `WorkoutPlayer.tsx`).
- The share-token player path (`app/s/[token]`) has **no** run PATCH route — it persists to localStorage only. Do not add one in this plan.

---

### Task 1: Server-side completion gate in `runState`

**Files:**
- Modify: `lib/workout/runState.ts` (add exported predicate below `buildRunUpdate`, ~L114)
- Test: `lib/workout/runState.test.ts` (append new describe block)

**Interfaces:**
- Produces: `redFlagBlocksCompletion(existing: RunRow, patch: RunPatch): boolean` — true iff this patch would newly complete the run while the acknowledgement is still absent after applying the patch. Task 2's route change consumes it.

- [ ] **Step 1: Write the failing tests**

Append to `lib/workout/runState.test.ts` (reuse the file's existing `RunRow` fixture helper if one exists; otherwise this local helper):

```ts
import { redFlagBlocksCompletion, type RunRow } from './runState'

const row = (over: Partial<RunRow> = {}): RunRow => ({
  status: 'in_progress',
  current_item_index: 1,
  items: [],
  total_duration_ms: 1000,
  last_paused_at: null,
  completed_at: null,
  revision: 3,
  red_flag_acknowledged: null,
  ...over,
})

describe('redFlagBlocksCompletion', () => {
  it('blocks completion when ack is absent everywhere', () => {
    expect(redFlagBlocksCompletion(row(), { status: 'completed' })).toBe(true)
  })
  it('allows completion when the patch itself carries the ack', () => {
    expect(
      redFlagBlocksCompletion(row(), { status: 'completed', red_flag_acknowledged: true }),
    ).toBe(false)
  })
  it('allows completion when the row was already acknowledged', () => {
    expect(
      redFlagBlocksCompletion(row({ red_flag_acknowledged: true }), { status: 'completed' }),
    ).toBe(false)
  })
  it('never blocks non-completing patches', () => {
    expect(redFlagBlocksCompletion(row(), { status: 'in_progress' })).toBe(false)
    expect(redFlagBlocksCompletion(row(), { current_item_index: 2 })).toBe(false)
  })
  it('never blocks a re-send to an already-completed run (terminal, no-op)', () => {
    expect(
      redFlagBlocksCompletion(row({ status: 'completed' }), { status: 'completed' }),
    ).toBe(false)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run lib/workout/runState.test.ts`
Expected: FAIL — `redFlagBlocksCompletion` is not exported.

- [ ] **Step 3: Implement the predicate**

Add to `lib/workout/runState.ts` directly after `buildRunUpdate` (keep the file's comment style):

```ts
/**
 * The pre-session red-flag screen is a safety control, not telemetry: a run may
 * not be marked completed unless the acknowledgement exists (on the row or in
 * this patch). Mirrors buildRunUpdate's completion semantics — terminal runs
 * are unaffected.
 */
export function redFlagBlocksCompletion(existing: RunRow, patch: RunPatch): boolean {
  const wouldComplete = patch.status === 'completed' && existing.status !== 'completed'
  if (!wouldComplete) return false
  const ackAfterPatch = patch.red_flag_acknowledged === true || existing.red_flag_acknowledged === true
  return !ackAfterPatch
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run lib/workout/runState.test.ts`
Expected: PASS (all pre-existing tests still green).

- [ ] **Step 5: Commit**

```bash
git add lib/workout/runState.ts lib/workout/runState.test.ts
git commit -m "feat(workout): red-flag acknowledgement gates run completion (predicate)"
```

---

### Task 2: Enforce the gate in the run route

**Files:**
- Modify: `app/api/workouts/[id]/run/route.ts:71-75` (between `buildRunUpdate` call and the DB update)

**Interfaces:**
- Consumes: `redFlagBlocksCompletion` from Task 1.
- Produces: HTTP 422 `{ error: 'Session completion requires the pre-session check.' }` + structured log `outcome: 'red_flag_block'` when a completing patch lacks the ack. Task 3's client change guarantees legitimate flows always carry the ack, so this 422 only fires for forged/broken clients.

- [ ] **Step 1: Modify the route**

In `app/api/workouts/[id]/run/route.ts`, import the predicate (line 6):

```ts
import { buildRunUpdate, redFlagBlocksCompletion, type RunRow } from '@/lib/workout/runState'
```

Insert immediately BEFORE `const update = buildRunUpdate(...)` (currently ~L71):

```ts
  // Safety control: completion is refused, not silently absorbed, when the
  // pre-session red-flag screen was never acknowledged (see runState).
  if (redFlagBlocksCompletion(existing as RunRow, parsed.data)) {
    logEvent({ route: ROUTE, outcome: 'red_flag_block', status: 422, userHash })
    return NextResponse.json(
      { error: 'Session completion requires the pre-session check.' },
      { status: 422 },
    )
  }
```

- [ ] **Step 2: Typecheck + vocab sweep**

Run: `npx tsc --noEmit && npx vitest run lib/ui-vocabulary.test.ts`
Expected: both PASS (copy above contains no banned stems).

- [ ] **Step 3: Manual route verification (local)**

With `supabase status` showing 127.0.0.1 and `npm run dev` running, exercise the e2e helper flow manually or via a scratch Playwright request: PATCH a freshly minted session's run with `{ "status": "completed", "revision": 1 }` and no ack.
Expected: HTTP 422 with the error message above; PATCH again with `{ "status": "completed", "red_flag_acknowledged": true, "revision": 2 }` → 200.

- [ ] **Step 4: Commit**

```bash
git add app/api/workouts/[id]/run/route.ts
git commit -m "feat(api): reject run completion without red-flag acknowledgement (422)"
```

---

### Task 3: Client — ack rides every patch; gate re-asked on every mount (incl. resume)

**Files:**
- Modify: `app/workouts/_player/WorkoutPlayer.tsx:103` (`active`), `:149-168` (speech effect guard), `:176-199` (save effect), `:321-341` (render gates)

**Interfaces:**
- Consumes: existing `redFlag` state (`:98`), `RedFlagCard`/`StopCard` components (`:727`, `:779`) — unchanged.
- Produces: (a) no clock tick, wake-lock, or voice cue until `redFlag === 'clear'`; (b) `RedFlagCard` renders on ANY non-summary phase while `redFlag === 'unasked'` (fresh AND resumed sessions); (c) every persisted patch after clearance carries `red_flag_acknowledged: true`.

- [ ] **Step 1: Gate the clock and wake-lock**

Change line 103 from:

```ts
  const active = state.phase !== 'idle' && state.phase !== 'summary'
```

to:

```ts
  // The player is inert until the red-flag screen is answered clear — a resumed
  // session lands in 'upNext' and must NOT auto-advance past the safety check.
  const active = state.phase !== 'idle' && state.phase !== 'summary' && redFlag === 'clear'
```

- [ ] **Step 2: Guard the voice cue**

In the speech effect (`:149-168`), add after the `voiceMuted` early-return block:

```ts
    if (redFlag !== 'clear') return
```

and add `redFlag` to that effect's dependency array.

- [ ] **Step 3: Ack rides every patch**

In the save effect (`:176-199`), the patch (currently `status`, `current_item_index`, `items`, `total_duration_ms`) gains one field:

```ts
    const patch: RunPatch = {
      status,
      current_item_index: Math.min(state.index, total),
      items,
      total_duration_ms: state.elapsedMs,
      // Idempotent ratchet server-side; guarantees a completing patch always
      // carries the acknowledgement even if the initial clear-time write raced.
      ...(redFlag === 'clear' ? { red_flag_acknowledged: true } : {}),
    }
```

Add `redFlag` to the effect's dependency array. Keep `onRedFlagClear` (`:232-237`) as-is — the immediate best-effort write is still the earliest record.

- [ ] **Step 4: Re-structure the render gates**

Replace the three phase-gated cards (`:321-341`) so `redFlag` is the outer gate and phase is inner. The `upNext`/`preroll`/`playing` blocks below them keep their phase conditions but must not render while unanswered — wrap ALL phase content in the ternary:

```tsx
          {redFlag === 'unasked' && state.phase !== 'summary' && (
            <Fade key="redflag" reduce={!!reduceMotion}>
              <RedFlagCard
                accent={accent}
                onClear={onRedFlagClear}
                onStop={() => setRedFlag('stopped')}
              />
            </Fade>
          )}

          {redFlag === 'stopped' && state.phase !== 'summary' && (
            <Fade key="stopped" reduce={!!reduceMotion}>
              <StopCard onDismiss={onExit} />
            </Fade>
          )}

          {redFlag === 'clear' && (state.phase === 'idle' || state.phase === 'intro') && (
            <Fade key="intro" reduce={!!reduceMotion}>
              <StartCard snapshot={snapshot} clientFirstName={clientFirstName} onBegin={begin} accent={accent} />
            </Fade>
          )}

          {redFlag === 'clear' && state.phase === 'upNext' && item && (
            ...existing UpNext block unchanged...
          )}
```

Prefix every remaining phase block (`preroll`, `playing`/`resting`, `summary` excepted) with `redFlag === 'clear' && `. `summary` renders regardless (a finished session's recap is not a safety surface).

- [ ] **Step 5: Full test suite + lint**

Run: `npx vitest run && npm run lint`
Expected: 540+ tests pass; lint shows only the 9 pre-existing errors (tracked separately — do not fix here; surgical changes only).

- [ ] **Step 6: Commit**

```bash
git add app/workouts/_player/WorkoutPlayer.tsx
git commit -m "feat(workout): re-ask red-flag screen on every mount and gate playback clock on clearance"
```

---

### Task 4: e2e — resume re-asks the question

**Files:**
- Modify: `e2e/workout-player.spec.ts` (append flow 3 inside the existing describe; reuse `mintSession`)

- [ ] **Step 1: Write the spec**

```ts
  test('flow 3: resuming a session with prior progress re-asks the red-flag question before playback', async ({ page }) => {
    const sessionId = await mintSession(page)
    await page.goto(`/workouts/${sessionId}`)

    // First visit: clear the gate and begin, generating persisted progress.
    await page.getByTestId('red-flag-no').click()
    await page.getByRole('button', { name: 'Begin session' }).click()
    await expect(page.getByText(/up next/i)).toBeVisible({ timeout: 8_000 })

    // Reload — resumePlayer now has prior progress and would previously
    // auto-play. The gate must render again, with no timeline behind it.
    await page.reload()
    await expect(
      page.getByText('Before you start — are you feeling any sharp or worsening pain right now?'),
    ).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText(/up next/i)).not.toBeVisible()

    // Clearing it resumes at the persisted item, not from scratch.
    await page.getByTestId('red-flag-no').click()
    await expect(page.getByText(/up next/i)).toBeVisible({ timeout: 8_000 })
  })
```

- [ ] **Step 2: Run e2e**

Run: `npm run test:e2e -- --grep "red-flag"`
Expected: flows 1, 2, and 3 PASS on chromium.

- [ ] **Step 3: Commit**

```bash
git add e2e/workout-player.spec.ts
git commit -m "test(e2e): resume re-asks the red-flag screen before playback"
```

---

### Task 5: Practitioner visibility — run list with pain-check badge

**Files:**
- Modify: `app/api/workouts/route.ts` (add a GET handler beside the existing POST)
- Modify: `app/assessments/[id]/page.tsx` (fetch + render inside the "Guided corrective session" card, near `:989-1020`)

**Interfaces:**
- Produces: `GET /api/workouts?assessment_id=<uuid>` → `{ runs: Array<{ session_id: string; created_at: string; status: string; red_flag_acknowledged: boolean | null; completed_at: string | null }> }`, practitioner-scoped.

- [ ] **Step 1: Add the GET handler**

In `app/api/workouts/route.ts`, following the POST's auth/gate pattern exactly (auth → `practitionerGate` → service client scoped by `practitioner_id`):

```ts
export async function GET(req: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const gate = await practitionerGate(supabase, user.id)
  if (gate) return gate

  const assessmentId = req.nextUrl.searchParams.get('assessment_id')
  if (!assessmentId || !z.string().uuid().safeParse(assessmentId).success) {
    return NextResponse.json({ error: 'Invalid assessment id' }, { status: 400 })
  }

  const service = createSupabaseServiceClient()
  const { data, error } = await service
    .from('workout_sessions')
    .select('id, created_at, session_runs(status, red_flag_acknowledged, completed_at)')
    .eq('assessment_id', assessmentId)
    .eq('practitioner_id', user.id)
    .order('created_at', { ascending: false })
    .limit(20)
  if (error) return NextResponse.json({ error: 'Failed to load runs.' }, { status: 500 })

  const runs = (data ?? []).flatMap((s) =>
    (s.session_runs ?? []).map((r) => ({
      session_id: s.id,
      created_at: s.created_at,
      status: r.status,
      red_flag_acknowledged: r.red_flag_acknowledged,
      completed_at: r.completed_at,
    })),
  )
  return NextResponse.json({ runs })
}
```

Verify the embed name matches the FK (`session_runs.workout_session_id → workout_sessions.id`, seeded in `20260702000000_workout_sessions.sql`); if PostgREST needs the explicit hint, use `session_runs!workout_session_id(...)`.

- [ ] **Step 2: Render the list on the assessment page**

In `app/assessments/[id]/page.tsx`, inside the guided-session card (below the Launch button block ending ~`:1020`), fetch once on mount alongside the page's existing fetch pattern and render (copy passes the vocab ban — "pain check", never clinical stems):

```tsx
{runList.length > 0 && (
  <div style={{ marginTop: 14, borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: 12 }}>
    <div style={{ fontSize: 12, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#A1A1AA', marginBottom: 8 }}>Session runs</div>
    {runList.map((r) => (
      <div key={r.session_id + r.created_at} style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 13, color: '#D4D4D8', padding: '4px 0' }}>
        <span>{new Date(r.created_at).toLocaleDateString()}</span>
        <span style={{ textTransform: 'capitalize' }}>{r.status.replace('_', ' ')}</span>
        <span style={{ color: r.red_flag_acknowledged ? '#34D399' : '#F59E0B', fontWeight: 700 }}>
          {r.red_flag_acknowledged ? 'Pain check: clear' : 'Pain check: not recorded'}
        </span>
      </div>
    ))}
  </div>
)}
```

- [ ] **Step 3: Verify vocab + types + tests**

Run: `npx tsc --noEmit && npx vitest run lib/ui-vocabulary.test.ts && npx vitest run`
Expected: all PASS.

- [ ] **Step 4: e2e assertion (extend flow 1)**

At the end of flow 1 in `e2e/workout-player.spec.ts`, after the session starts, navigate back and assert the badge:

```ts
    // The practitioner-facing run list reflects the acknowledged pain check.
    await page.goto(`/assessments/${assessmentId}`)
    await expect(page.getByText('Pain check: clear')).toBeVisible({ timeout: 10_000 })
```

(`mintSession` must return `{ sessionId, assessmentId }` — adjust the helper and both existing call sites.)

Run: `npm run test:e2e -- --grep "red-flag"` → PASS.

- [ ] **Step 5: Commit + land**

```bash
git add app/api/workouts/route.ts 'app/assessments/[id]/page.tsx' e2e/workout-player.spec.ts
git commit -m "feat(workout): practitioner-facing session-run list with pain-check status"
~/bin/zs-land
```

---

## Self-Review Notes

- **Spec coverage:** resume re-gate (Task 3), server enforcement (Tasks 1–2), practitioner visibility (Task 5), resume e2e (Task 4) — all four audit findings addressed.
- **Deliberate non-goals:** share-token path stays localStorage-only (no PATCH route exists; adding one is new attack surface, out of scope); rate-limiting the run route is tracked in the audit's carried findings, not here; the `WorkoutPlayer.tsx` 815-line split is the hygiene batch's job — do NOT restructure beyond the listed edits.
- **Type consistency:** `RunPatch.red_flag_acknowledged?: boolean` already exists (route Zod `:23`, ratchet `runState.ts:99-100`); `redFlagBlocksCompletion` consumes the same types.
- **Risk:** Task 3 Step 4 touches the largest render block — run flows 1/2 e2e after it, before writing flow 3.
