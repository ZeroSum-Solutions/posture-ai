# Exercise Media & Content Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the guided workout player demo-quality — real demonstration media, short coached voice cues, step-by-step instructions — plus media thumbnails on the browse/results surfaces and a modestly expanded exercise bank.

**Architecture:** Media and coaching text are pure *data* flowing through one seam: `content/exercises/*.ts` (Zod-validated) → `SessionItem` (flattener copies fields) → player render. The player degrades gracefully at every layer (video → poster → today's gradient), so every phase ships demo-functional even with zero clips. Clip *source* (MoveKit) is swappable without teardown; a pre-purchase coverage check gates the $99 spend (decision O4).

**Tech Stack:** Next.js 16 App Router, React 19, Zod, Vitest, Playwright, Supabase (Postgres + Storage), framer-motion. Player styling is inline-style based — follow that, no Tailwind classes in the player.

## Design summary (approved 2026-07-04)

- **Free-media research verdict:** no free source offers licensed *animated* exercise media (full report in session; ExerciseDB CDN is dead/auth-gated, free-exercise-db images have unsafe provenance, wger has ~0 posture media, MuscleWiki ToS forbids reuse). MoveKit ($99, ~206 mannequin loops, commercial license) is the vetted source — **but only after a coverage check against our 55 exercises** (Phase 4 gate; Devin makes the purchase).
- **exercises-dataset** (`data/exercises-dataset/`, 1,324 records, no OSS license): used as *reference text only*. Its `instruction_steps.en` inform our own rewritten steps. **Never copy sentences verbatim, never ship its text or media.**
- New optional `steps: string[]` content field; existing optional `media`/`form` fields get populated and wired end-to-end.
- Saved `SessionSnapshot`s predating this work lack the new fields — all consumers treat them as optional. Snapshot `version` stays `1` (additive change only).

## Global Constraints

- **Screening vocabulary:** every authored or generated user-facing string must be free of `diagnos*`, `treat*`, `cure*`, `patient*`, `prescri*` (`BANNED_TERM_PATTERNS`, `content/muscles/types.ts:6`). Zod `screeningText` gates authored fields at parse time; `assertScreeningText` gates generated strings.
- **Dataset hygiene:** `data/exercises-dataset/` text is reference-only; write all instructions/steps/cues in our own words. Its media is never fetched or shipped.
- **Migrations are forward-only**, applied via Supabase Management API per `docs/RUNBOOK.md` (project ref `dhrkezfypzutiwtmcmof`, token `SUPABASE_ACCESS_TOKEN` from env). Never `supabase db push`, never the claude.ai Supabase MCP connector.
- **Git:** conventional commits (`feat:`, `test:`, `chore:`...), no attribution lines/Co-Authored-By. One branch per phase; land each phase with `~/bin/zs-land` after tests are green.
- **Verification commands:** unit/content `npx vitest run`; e2e `npx playwright test` (requires `npx supabase start` first; serial, ~few min). Both must be green before landing a phase.
- **Counts:** 55 exercise content files exist in `content/exercises/` (not 56). `content/index.ts` is auto-generated — after adding content files run `node scripts/generate-content-index.mjs`, never hand-edit.
- **Model/escalation:** built for a Sonnet-class executor. If Phase 4's catalog scrape defeats you after 2 attempts, stop and report — do not brute-force.

---

## Phase 0: Housekeeping

### Task 0: Commit the dataset gitignore

**Files:**
- Modify: `.gitignore` (change already sitting unstaged: adds `data/exercises-dataset/`)

- [ ] **Step 1: Verify and commit**

```bash
git status --short   # expect: M .gitignore only
git diff .gitignore  # expect: + data/exercises-dataset/
git add .gitignore && git commit -m "chore: gitignore nested exercises-dataset clone"
```

This lands directly on `main` (docs/ignore-only, no code) — or fold it into the Phase 1 branch if `main` is protected locally.

---

## Phase 1: Pipeline wiring (branch `feat/player-media-pipeline`)

Everything in this phase works with zero media files — fallbacks render. `doorway-pec-stretch` becomes the pilot exercise carrying real `form` + `steps` so tests exercise the full path.

### Task 1: Add `steps` to the exercise schema + pilot content

**Files:**
- Modify: `content/muscles/types.ts:147` (after `instructions` in `exerciseContentSchema`)
- Modify: `content/exercises/doorway-pec-stretch.ts`
- Test: `content/exercise-steps-schema.test.ts` (new)

**Interfaces:**
- Produces: `ExerciseContent.steps?: string[]` — consumed by Tasks 2, 4, and all of Phase 2.

- [ ] **Step 1: Write the failing test**

```ts
// content/exercise-steps-schema.test.ts
import { describe, test, expect } from 'vitest'
import { exerciseContentSchema } from './muscles/types'
import { doorwayPecStretch } from './exercises/doorway-pec-stretch'

describe('exerciseContentSchema.steps', () => {
  test('accepts a valid steps array', () => {
    const parsed = exerciseContentSchema.parse({
      ...doorwayPecStretch,
      steps: ['Stand tall in an open doorway with feet hip-width apart.', 'Rest your forearm on the frame with the elbow bent to ninety degrees.'],
    })
    expect(parsed.steps).toHaveLength(2)
  })

  test('steps is optional', () => {
    const { steps: _omit, ...rest } = { ...doorwayPecStretch, steps: undefined }
    expect(() => exerciseContentSchema.parse(rest)).not.toThrow()
  })

  test('rejects a banned term inside a step', () => {
    expect(() =>
      exerciseContentSchema.parse({
        ...doorwayPecStretch,
        steps: ['This step will treat your shoulder pain quickly today.', 'Second step keeps the array above the minimum length.'],
      }),
    ).toThrow(/Banned non-screening term/)
  })

  test('rejects a single-step array', () => {
    expect(() =>
      exerciseContentSchema.parse({ ...doorwayPecStretch, steps: ['Only one step is not a sequence worth rendering.'] }),
    ).toThrow()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run content/exercise-steps-schema.test.ts`
Expected: FAIL — `steps` is stripped/unknown, first assertion gets `undefined`.

- [ ] **Step 3: Add the schema field**

In `content/muscles/types.ts`, directly after the `instructions` line (147):

```ts
    /**
     * Discrete coaching steps for the player's Up-Next step list and detail
     * surfaces — always our own wording (third-party dataset text is
     * reference only, never copied).
     */
    steps: z.array(screeningText(20, 160)).min(2).max(8).optional(),
```

- [ ] **Step 4: Add pilot `form` + `steps` to doorway-pec-stretch**

In `content/exercises/doorway-pec-stretch.ts`, add after `holdSeconds: 30,`:

```ts
  steps: [
    'Stand tall in an open doorway with feet hip-width apart.',
    'Place your forearm on the door frame, elbow bent to ninety degrees at shoulder height.',
    'Step the same-side foot forward slowly until you feel a gentle stretch across the chest.',
    'Breathe steadily and keep the ribs stacked over the pelvis for the full hold.',
    'Ease back out, then repeat on the other side.',
  ],
  form: {
    alignmentCue: 'Keep your ribs stacked over your pelvis and let the chest open gradually.',
    avoidCue: 'Avoid shrugging the shoulder or arching the lower back to chase a deeper stretch.',
  },
```

- [ ] **Step 5: Run tests, verify pass**

Run: `npx vitest run content`
Expected: all content tests PASS (existing suites still green — the field is additive).

- [ ] **Step 6: Commit**

```bash
git add content/muscles/types.ts content/exercises/doorway-pec-stretch.ts content/exercise-steps-schema.test.ts
git commit -m "feat: add steps field to exercise schema with doorway-pec-stretch pilot"
```

### Task 2: Carry `media`/`form`/`steps` on SessionItem

**Files:**
- Modify: `lib/workout/generateWorkoutSession.ts` (interface at :24-38, lookup at :66, flattener at :99-111)
- Test: `lib/workout/generateWorkoutSession.test.ts` (extend)

**Interfaces:**
- Consumes: `ExerciseContent['media' | 'form' | 'steps']` from Task 1.
- Produces: `SessionItem.media?: { loopUrl: string; posterUrl: string; fallbackGifUrl?: string }`, `SessionItem.form?: { alignmentCue: string; avoidCue: string; tempo?: string }`, `SessionItem.steps?: string[]` — consumed by Tasks 3 & 4.

- [ ] **Step 1: Write the failing test**

Append to `lib/workout/generateWorkoutSession.test.ts` a new describe block. Reuse whatever `ProgramReport` fixture the file already builds (it constructs reports for existing tests — use the same one; do not invent a new fixture):

```ts
import { ALL_EXERCISES } from '../../content'

describe('content field passthrough', () => {
  test('every session item mirrors its content exercise media/form/steps', () => {
    const snap = generateWorkoutSession(report, { week: 1 }) // `report` = the file's existing fixture
    expect(snap).not.toBeNull()
    for (const item of snap!.items) {
      const ex = ALL_EXERCISES.find((e) => e.slug === item.slug)!
      expect(item.media).toEqual(ex.media)
      expect(item.form).toEqual(ex.form)
      expect(item.steps).toEqual(ex.steps)
    }
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/workout/generateWorkoutSession.test.ts`
Expected: FAIL — `item.media` etc. don't exist (undefined vs undefined passes trivially ONLY if the fixture report contains no exercise with content fields; if it happens to pass, add `doorway-pec-stretch` coverage: assert at least one item in a report built over `anterior_imbalanced_shoulders` has `steps` defined. The point of the loop test is that it strengthens automatically as Phase 2 fills content).

- [ ] **Step 3: Implement**

In `lib/workout/generateWorkoutSession.ts`:

Extend `SessionItem` (after `instructions: string`):

```ts
  /** Optional demonstration media copied from content — player falls back to poster/gradient when absent. */
  media?: ExerciseContent['media']
  /** Optional short coaching cues copied from content. */
  form?: ExerciseContent['form']
  /** Optional discrete coaching steps copied from content. */
  steps?: string[]
```

Replace the lookup map at line 66:

```ts
const exerciseBySlug = new Map(ALL_EXERCISES.map((ex) => [ex.slug, ex]))
```

In the flattener (inside the `for (const step of priority.steps)` loop), resolve once and copy:

```ts
      const ex = exerciseBySlug.get(step.slug)
      flat.push({
        slug: step.slug,
        baseSlug: step.baseSlug,
        name: step.name,
        category: step.category,
        stepLabel: step.stepLabel,
        priorityKey: priority.primaryKey,
        priorityLabel: priority.label,
        isIntegrative: step.isIntegrative,
        instructions: ex?.instructions ?? '',
        media: ex?.media,
        form: ex?.form,
        steps: ex?.steps,
        timing: toTiming(dose, step.category, step.isIntegrative),
        priorityRank: priority.rank,
      })
```

(Undefined fields drop out of the persisted JSON snapshot — old snapshots stay valid, `version: 1` unchanged.)

- [ ] **Step 4: Run tests, verify pass**

Run: `npx vitest run lib/workout`
Expected: PASS, including the existing snapshot tests in `__snapshots__` (if a stored snapshot diff appears, it will only ADD optional keys for doorway-pec-stretch — inspect, then update with `npx vitest run lib/workout -u` and eyeball the diff).

- [ ] **Step 5: Commit**

```bash
git add lib/workout/generateWorkoutSession.ts lib/workout/generateWorkoutSession.test.ts lib/workout/__snapshots__
git commit -m "feat: carry media, form cues and steps on SessionItem"
```

### Task 3: Voice cues use `form` when present

**Files:**
- Modify: `lib/workout/cues.ts` (`voiceCue` playing case :26-38, `caption` :48-61)
- Test: `lib/workout/cues.test.ts` (extend)

**Interfaces:**
- Consumes: `SessionItem.form` from Task 2.
- Produces: cue behavior — set 1 speaks `alignmentCue`, sets ≥2 speak `avoidCue`; playing caption shows `alignmentCue` instead of the long instructions when form exists.

- [ ] **Step 1: Write the failing tests**

Append to `lib/workout/cues.test.ts` (reuse the file's `makeItem` helper):

```ts
const formItem = makeItem(
  { kind: 'hold', sets: 2, secondsPerSet: 30, restSeconds: 10 },
  {
    form: {
      alignmentCue: 'Keep the back of your neck long and your gaze level.',
      avoidCue: 'Avoid jutting the chin forward as you release.',
    },
  },
)

describe('cues.form', () => {
  test('set 1 speech ends with the alignment cue', () => {
    expect(voiceCue('playing', formItem, 1)!.speech).toContain('Keep the back of your neck long')
  })
  test('set 2 speech uses the avoid cue instead', () => {
    const s = voiceCue('playing', formItem, 2)!.speech
    expect(s).toContain('Avoid jutting the chin forward')
    expect(s).not.toContain('Keep the back of your neck long')
  })
  test('playing caption is the alignment cue when form exists, instructions otherwise', () => {
    expect(caption('playing', formItem)).toBe(formItem.form!.alignmentCue)
    expect(caption('playing', holdItem)).toBe(holdItem.instructions)
  })
  test('form cues pass the screening gate end-to-end', () => {
    for (const set of [1, 2]) {
      const c = voiceCue('playing', formItem, set)!
      expect(() => assertScreeningText(c.speech)).not.toThrow()
      expect(() => assertScreeningText(c.caption)).not.toThrow()
    }
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/workout/cues.test.ts`
Expected: FAIL — speech lacks the cue text.

- [ ] **Step 3: Implement**

Replace the `'playing'` case in `voiceCue`:

```ts
    case 'playing': {
      if (!item) return null
      // Set 1 coaches alignment; later sets warn against the common fault.
      // Cues are authored as complete sentences, so plain concatenation is safe.
      const coach =
        set > 1 && item.form?.avoidCue
          ? ` ${item.form.avoidCue}`
          : item.form?.alignmentCue
            ? ` ${item.form.alignmentCue}`
            : ''
      const capText = item.form?.alignmentCue ?? item.instructions
      if (item.timing.kind === 'hold') {
        return {
          speech: `${setPrefix}${item.name}. Hold for ${item.timing.secondsPerSet} seconds.${coach}`,
          caption: capText,
        }
      }
      return {
        speech: `${setPrefix}${item.name}. ${item.timing.repsPerSet} reps.${coach}`,
        caption: capText,
      }
    }
```

And in `caption()`:

```ts
    case 'playing':
      return item?.form?.alignmentCue ?? item?.instructions ?? ''
```

- [ ] **Step 4: Run tests, verify pass**

Run: `npx vitest run lib/workout/cues.test.ts`
Expected: PASS (all pre-existing cue tests too — items without `form` behave exactly as before).

- [ ] **Step 5: Commit**

```bash
git add lib/workout/cues.ts lib/workout/cues.test.ts
git commit -m "feat: voice cues and captions use authored form cues when present"
```

### Task 4: Player renders media with layered fallback + Up-Next steps

**Files:**
- Modify: `app/workouts/_player/WorkoutPlayer.tsx` (`DemoCanvas` :369-420, `UpNext` :469-489, preload effect in `WorkoutPlayer` body)

**Interfaces:**
- Consumes: `SessionItem.media`, `SessionItem.steps` from Task 2.
- Produces: UI only. Fallback chain: playing video → its poster (reduced-motion/buffering) → today's gradient+watermark (no media or load error). "Never a broken `<video>`."

No unit test — this is presentation; verification is the full e2e suite (fallback path = current behavior since no content has `media` yet) plus a manual smoke check.

- [ ] **Step 1: Rewrite `DemoCanvas`**

Replace the whole `DemoCanvas` component (keep the `memo` wrapper and comment):

```tsx
const DemoCanvas = memo(function DemoCanvas({ item, accent, active, reduceMotion }: { item?: SessionItem; accent: string; active: boolean; reduceMotion: boolean }) {
  // A clip that 404s/decode-fails must never leave a black hole — flip to the
  // gradient fallback for this slug only, and re-arm on the next item.
  const [mediaFailed, setMediaFailed] = useState(false)
  useEffect(() => setMediaFailed(false), [item?.slug])
  const media = mediaFailed ? undefined : item?.media

  return (
    <div aria-hidden="true" style={{ position: 'absolute', inset: 0, zIndex: 1, overflow: 'hidden' }}>
      {/* gradient underlay always renders — the video sits above it, so a slow clip fades in over brand, not black */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: `radial-gradient(120% 80% at 50% 18%, ${accent}22 0%, transparent 55%), radial-gradient(90% 60% at 50% 108%, ${accent}18 0%, transparent 60%), #08080A`,
          transition: 'background 0.8s ease',
        }}
      />
      {!media && (
        <motion.div
          animate={reduceMotion ? undefined : { scale: active ? [1, 1.08, 1] : 1, opacity: active ? [0.5, 0.75, 0.5] : 0.35 }}
          transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut' }}
          style={{
            position: 'absolute',
            top: '34%',
            left: '50%',
            width: 460,
            height: 460,
            marginLeft: -230,
            marginTop: -230,
            borderRadius: '50%',
            background: `radial-gradient(circle, ${accent}55 0%, ${accent}00 68%)`,
            filter: 'blur(20px)',
          }}
        />
      )}
      {media && (
        <>
          <video
            key={item!.slug}
            src={media.loopUrl}
            poster={media.posterUrl}
            muted
            loop
            playsInline
            preload="auto"
            autoPlay={!reduceMotion}
            onError={() => setMediaFailed(true)}
            style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              opacity: active ? 0.92 : 0.55,
              transition: 'opacity 0.6s ease',
            }}
          />
          {/* scrim keeps the white HUD/caption legible over bright clip frames */}
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background: 'linear-gradient(180deg, rgba(8,8,10,0.55) 0%, rgba(8,8,10,0.18) 38%, rgba(8,8,10,0.72) 100%)',
            }}
          />
        </>
      )}
      {!media && item && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'center',
            fontSize: 'clamp(2.4rem, 9vw, 4.6rem)',
            fontWeight: 800,
            letterSpacing: '-0.02em',
            color: 'rgba(255,255,255,0.05)',
            textAlign: 'center',
            padding: '20% 24px 0',
            lineHeight: 1.05,
            userSelect: 'none',
          }}
        >
          {item.name}
        </div>
      )}
    </div>
  )
})
```

Also update the comment at the render site (line 229) from "placeholder until MoveKit clips are wired" to `{/* full-bleed demo canvas: clip loop → poster → gradient fallback */}`.

- [ ] **Step 2: Preload the next item's media**

In the `WorkoutPlayer` body (after the wake-lock effect):

```tsx
  // ---- warm the next item's clip + poster while the current one plays -----
  useEffect(() => {
    const next = state.items[state.index + 1] as SessionItem | undefined
    if (!next?.media) return
    const img = new Image()
    img.src = next.media.posterUrl
    const v = document.createElement('video')
    v.preload = 'auto'
    v.muted = true
    v.src = next.media.loopUrl
    // Fire-and-forget: both elements are detached and garbage-collectable;
    // the browser keeps the bytes in HTTP cache for the real <video>.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.index])
```

- [ ] **Step 3: Step list on the Up-Next screen**

In `UpNext`, insert between the `priorityLabel` paragraph and the button:

```tsx
      {item.steps && item.steps.length > 0 && (
        <ol
          style={{
            textAlign: 'left',
            maxWidth: 380,
            margin: '0 auto 22px',
            padding: '0 0 0 20px',
            color: '#A1A1AA',
            fontSize: '0.85rem',
            lineHeight: 1.55,
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
          }}
        >
          {item.steps.slice(0, 5).map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ol>
      )}
```

(And reduce the `priorityLabel` paragraph's bottom margin from `22px` to `12px` so the block doesn't double-space.)

- [ ] **Step 4: Full verification**

```bash
npx vitest run                 # all unit/content suites
npx supabase start             # if not already running
npx playwright test            # full e2e — fallback path must be byte-identical behavior
```
Expected: everything green (35 passed / 2 skipped baseline).

- [ ] **Step 5: Manual smoke (pilot media optional)**

To see the video path before Phase 4, temporarily point doorway-pec-stretch's `media` at any local mp4 under `public/` and run a session in the browser (`npm run dev`, complete a capture flow or use an existing assessment → Start workout). Confirm: clip renders under scrim, kill the URL → gradient fallback appears. **Revert the temporary media block before committing.**

- [ ] **Step 6: Commit and land Phase 1**

```bash
git add app/workouts/_player/WorkoutPlayer.tsx
git commit -m "feat: player demo canvas renders clip loop with poster/gradient fallback and up-next steps"
~/bin/zs-land
```

---

## Phase 2: Author `form` + `steps` for all 55 exercises (branch `feat/exercise-form-cues`)

### Authoring rules (apply to every batch)

- `form.alignmentCue`: ONE imperative sentence, 20–160 chars, ends with a period — what doing it *right* looks/feels like. Spoken aloud on set 1 and shown as the playing caption.
- `form.avoidCue`: ONE sentence, 20–160 chars — the most common fault, phrased "Avoid …" or "Keep … rather than …". Spoken on sets ≥ 2.
- `steps`: 3–6 strings, each 20–160 chars, one discrete action per step, ordered setup → movement → finish. Sides: end with "Repeat on the other side." where applicable.
- Omit `tempo` everywhere (YAGNI).
- Vocabulary: plain, encouraging, screening-safe. The Zod gate rejects `diagnos*/treat*/cure*/patient*/prescri*` — also avoid "pain", "injury", "corrects", "fixes" by convention (not schema-enforced; screening tone).
- **Dataset reference:** where a matching exercise exists in the dataset, read its steps for *content* ideas, then write your own sentences. Lookup helper below. Many of our PT-specific moves (chin tucks, wall angels…) have no dataset match — write from the existing `instructions` field, which already describes the movement.
- Do not modify any other field in the files. `doorway-pec-stretch.ts` was completed in Task 1 — skip it.

### Task 5: Dataset lookup helper

**Files:**
- Create: `scripts/dataset-lookup.mjs`

- [ ] **Step 1: Write the script**

```js
// Reference lookup into data/exercises-dataset (gitignored, license-unresolved:
// REFERENCE ONLY — never copy its text into content files verbatim).
// Usage: node scripts/dataset-lookup.mjs "pec stretch"
import { readFileSync } from 'node:fs'

const query = (process.argv[2] ?? '').toLowerCase()
if (!query) {
  console.error('usage: node scripts/dataset-lookup.mjs "<name fragment>"')
  process.exit(1)
}
const all = JSON.parse(readFileSync('data/exercises-dataset/data/exercises.json', 'utf8'))
const hits = all.filter((e) => e.name.toLowerCase().includes(query)).slice(0, 5)
if (hits.length === 0) console.log('no match — author from the existing instructions field')
for (const h of hits) {
  console.log(`\n=== ${h.name} (${h.category} / ${h.equipment}) ===`)
  for (const [i, s] of (h.instruction_steps?.en ?? []).entries()) console.log(`${i + 1}. ${s}`)
}
```

- [ ] **Step 2: Verify**

Run: `node scripts/dataset-lookup.mjs "glute bridge"`
Expected: prints 1–5 matches with numbered English steps.

- [ ] **Step 3: Commit**

```bash
git add scripts/dataset-lookup.mjs
git commit -m "chore: dataset reference lookup helper for content authoring"
```

### Worked example (model every file on this)

`content/exercises/glute-bridge.ts` gains, after its `holdSeconds` line:

```ts
  steps: [
    'Lie on your back with knees bent and feet flat, hip-width apart.',
    'Press through your heels and lift your hips until they line up with your knees and shoulders.',
    'Squeeze your glutes at the top for a brief pause.',
    'Lower back down with control, one segment at a time.',
  ],
  form: {
    alignmentCue: 'Drive through your heels and squeeze your glutes at the top of each rep.',
    avoidCue: 'Avoid arching your lower back to lift higher than your hips can go.',
  },
```

### Tasks 6–11: Author in six batches

Batch procedure (identical for every batch): edit the listed files per the rules → `npx vitest run content` (Zod validates every new field) → commit `feat: author form cues and steps for <region> exercises (batch N/6)`.

- [ ] **Task 6 — Batch 1/6, neck & head (9):** `chin-tucks`, `chin-tuck-head-lift`, `supine-chin-nod`, `neck-lateral-stretch`, `sternocleidomastoid-stretch`, `levator-scapulae-stretch`, `suboccipital-release`, `wall-angels`, `open-book-stretch`
- [ ] **Task 7 — Batch 2/6, shoulder girdle (9):** `band-pull-apart`, `seated-band-row`, `shoulder-blade-squeeze`, `prone-t-raise`, `prone-y-raise`, `push-up-plus`, `wall-push-up-plus`, `hands-behind-back-chest-opener`, `kneeling-lat-stretch`
- [ ] **Task 8 — Batch 3/6, trunk (9):** `cat-cow`, `thoracic-extension`, `childs-pose-reach`, `dead-bug`, `bird-dog`, `front-plank`, `side-plank`, `side-plank-knees`, `pallof-press`
- [ ] **Task 9 — Batch 4/6, hip & pelvis A (9):** `glute-bridge` (worked example above), `single-leg-glute-bridge`, `clamshell`, `side-lying-hip-abduction`, `lateral-band-walk`, `prone-hip-extension`, `supine-pelvic-tilt`, `kneeling-hip-flexor-stretch`, `standing-tfl-stretch`
- [ ] **Task 10 — Batch 5/6, hip & pelvis B (9):** `figure-four-stretch`, `butterfly-stretch`, `side-lunge-adductor-stretch`, `standing-ql-stretch`, `knees-to-chest-stretch`, `supine-crossover-stretch`, `foam-roll-lateral-thigh`, `standing-quad-stretch`, `split-squat`
- [ ] **Task 11 — Batch 6/6, knee & lower leg (9):** `terminal-knee-extension`, `standing-hamstring-curl`, `prone-hamstring-curl`, `single-leg-rdl`, `single-leg-balance`, `wall-sit`, `wall-calf-stretch`, `bent-knee-calf-stretch`, `seated-tibial-rotation`

(9×6 = 54 + doorway-pec-stretch from Task 1 = 55. If a listed slug doesn't match a filename exactly, `ls content/exercises/` and use the actual name — the six batches must cover all 55 files.)

### Task 12: Coverage gate

**Files:**
- Test: `content/exercise-coverage.test.ts` (new)

- [ ] **Step 1: Write the test (should pass immediately if batches are complete)**

```ts
import { describe, test, expect } from 'vitest'
import { ALL_EXERCISES } from './index'

// Every playable exercise must carry short coaching cues and discrete steps —
// the player's voice/captions and Up-Next list depend on them. Informational
// items are exempt (never played).
describe('exercise coaching coverage', () => {
  const playable = ALL_EXERCISES.filter((e) => e.category !== 'informational')
  test.each(playable.map((e) => [e.slug, e] as const))('%s has form and steps', (_slug, e) => {
    expect(e.form?.alignmentCue).toBeTruthy()
    expect(e.form?.avoidCue).toBeTruthy()
    expect(e.steps?.length).toBeGreaterThanOrEqual(2)
  })
})
```

- [ ] **Step 2: Run and fix any stragglers**

Run: `npx vitest run content/exercise-coverage.test.ts`
Expected: 55 passing rows. Any failure names the missing slug — author it and re-run.

- [ ] **Step 3: Full verify + land Phase 2**

```bash
npx vitest run && npx playwright test
git add content/exercise-coverage.test.ts && git commit -m "test: coverage gate — every playable exercise has form cues and steps"
~/bin/zs-land
```

---

## Phase 3: Media infrastructure + surfaces (branch `feat/exercise-media-surfaces`)

### Task 13: `exercise-media` storage bucket (migration)

**Files:**
- Create: `supabase/migrations/20260704000000_exercise_media_bucket.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Public-read bucket for exercise demo media ({slug}/loop.mp4, {slug}/poster.webp).
-- No storage RLS policies are added: public=true serves reads via the public URL,
-- and with no INSERT/UPDATE policies only the service role can write (upload
-- script in scripts/upload-exercise-media.mjs) — same sole-writer posture as the
-- regulated tables.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'exercise-media',
  'exercise-media',
  true,
  26214400, -- 25 MB per object
  array['video/mp4', 'image/webp', 'image/png', 'image/jpeg', 'image/gif']
)
on conflict (id) do nothing;
```

- [ ] **Step 2: Apply via Management API**

Follow `docs/RUNBOOK.md` migrations procedure exactly (curl to `api.supabase.com/v1/projects/dhrkezfypzutiwtmcmof/database/query` with `SUPABASE_ACCESS_TOKEN` — the RUNBOOK has the canonical command and the migration-ledger step).

- [ ] **Step 3: Verify**

```bash
curl -s "https://dhrkezfypzutiwtmcmof.supabase.co/storage/v1/object/public/exercise-media/nonexistent.txt" | head -c 200
```
Expected: a JSON "Object not found" error (NOT "Bucket not found") — proves the bucket exists and is publicly readable.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260704000000_exercise_media_bucket.sql
git commit -m "feat: public-read exercise-media storage bucket"
```

### Task 14: CSP allows Supabase-hosted media

**Files:**
- Modify: `next.config.ts:18-19`

- [ ] **Step 1: Extend `img-src` and `media-src`** (in the main `csp` array — NOT the viewer CSP):

```ts
      `img-src 'self' data: blob: ${supabaseOrigin}`.trim(),
      `media-src 'self' blob: ${supabaseOrigin}`.trim(),
```

- [ ] **Step 2: Verify**

```bash
npm run build 2>&1 | tail -5   # builds clean
npm run dev & sleep 8 && curl -sI http://localhost:3000 | grep -i content-security-policy && kill %1
```
Expected: header shows the Supabase origin in `img-src` and `media-src`.

- [ ] **Step 3: Commit**

```bash
git add next.config.ts
git commit -m "feat: allow supabase storage origin in img-src/media-src CSP"
```

### Task 15: Seed generator emits media columns

**Files:**
- Modify: `scripts/generate-muscle-seed.ts:39-49` (exercises upsert)

**Interfaces:**
- Consumes: `ExerciseContent.media` (populated in Phase 4).
- Produces: `exercises.video_url/poster_url/demo_gif_url` populated by the next generated seed — consumed by Task 16/17 UI.

- [ ] **Step 1: Extend the upsert**

Replace the exercises loop body:

```ts
for (const e of ALL_EXERCISES) {
  lines.push(
    `INSERT INTO exercises (slug, name, category, primary_deviation_keys, min_zone, instructions, sets, hold_seconds, video_url, poster_url, demo_gif_url) VALUES (` +
      [
        q(e.slug), q(e.name), q(e.category),
        `ARRAY[${e.primaryDeviationKeys.map(k => q(k)).join(', ')}]`,
        q(e.minZone), q(e.instructions), String(e.sets), String(e.holdSeconds),
        q(e.media?.loopUrl ?? null), q(e.media?.posterUrl ?? null), q(e.media?.fallbackGifUrl ?? null),
      ].join(', ') +
      `)\nON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, category = EXCLUDED.category, primary_deviation_keys = EXCLUDED.primary_deviation_keys, min_zone = EXCLUDED.min_zone, instructions = EXCLUDED.instructions, sets = EXCLUDED.sets, hold_seconds = EXCLUDED.hold_seconds, video_url = EXCLUDED.video_url, poster_url = EXCLUDED.poster_url, demo_gif_url = EXCLUDED.demo_gif_url;`
  )
}
```

- [ ] **Step 2: Verify**

Run: `npx vite-node scripts/generate-muscle-seed.ts | grep -A1 "doorway-pec-stretch" | head -4`
Expected: the INSERT includes three trailing `NULL, NULL, NULL` (no media authored yet). Do NOT create/apply a seed migration now — that happens in Phase 4 when media URLs exist.

- [ ] **Step 3: Commit**

```bash
git add scripts/generate-muscle-seed.ts
git commit -m "feat: seed generator emits exercise media columns"
```

### Task 16: Thumbnails on `/exercises`

**Files:**
- Modify: `app/exercises/page.tsx` (type :6-13, select :48, card :104+)

- [ ] **Step 1: Implement**

Add to the `Exercise` type: `poster_url: string | null`. Change the select to `'id, name, category, instructions, sets, hold_seconds, poster_url'`. At the top of the card div (before the name/pill row):

```tsx
              {ex.poster_url && (
                <img
                  src={ex.poster_url}
                  alt=""
                  loading="lazy"
                  style={{ width: '100%', aspectRatio: '16 / 10', objectFit: 'cover', borderRadius: 8, marginBottom: 10, background: '#0A0A0B' }}
                />
              )}
```

- [ ] **Step 2: Verify**

`npm run dev`, sign in, open `/exercises`. Expected: page renders exactly as before (all `poster_url` are NULL); no console errors.

- [ ] **Step 3: Commit**

```bash
git add app/exercises/page.tsx
git commit -m "feat: exercise library cards show poster thumbnails when present"
```

### Task 17: Exercise detail sheet on the results program

**Files:**
- Create: `app/assessments/[id]/ExerciseDetailSheet.tsx`
- Modify: `app/assessments/[id]/PriorityProgram.tsx` (exercise name at :140 becomes a button; sheet state in the default export)

**Interfaces:**
- Consumes: `exercises` table columns (`slug, name, category, instructions, sets, hold_seconds, video_url, poster_url`) + `exercise_muscles (muscle_slug, role)` via the browser Supabase client.
- Produces: `<ExerciseDetailSheet slug={string} name={string} onClose={() => void} />`.

- [ ] **Step 1: Create the sheet component**

```tsx
'use client'
/**
 * Bottom-sheet exercise detail for the coach-facing program: demo loop (or
 * poster), authored instructions, dose, and muscle roles. Read-only; fetched
 * on open from the exercises KB (RLS: authenticated read).
 */
import { useEffect, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'

type Detail = {
  name: string
  category: string
  instructions: string | null
  sets: number | null
  hold_seconds: number | null
  video_url: string | null
  poster_url: string | null
}
type MuscleRole = { muscle_slug: string; role: 'stretch' | 'strengthen' }

export default function ExerciseDetailSheet({ slug, name, onClose }: { slug: string; name: string; onClose: () => void }) {
  const [detail, setDetail] = useState<Detail | null>(null)
  const [muscles, setMuscles] = useState<MuscleRole[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const supabase = createSupabaseBrowserClient()
    let cancelled = false
    supabase
      .from('exercises')
      .select('name, category, instructions, sets, hold_seconds, video_url, poster_url')
      .eq('slug', slug)
      .single()
      .then(async ({ data, error: err }) => {
        if (cancelled) return
        if (err || !data) { setError('Could not load exercise details.'); return }
        setDetail(data)
        const { data: em } = await supabase
          .from('exercise_muscles')
          .select('muscle_slug, role')
          .eq('exercise_id', (await supabase.from('exercises').select('id').eq('slug', slug).single()).data?.id ?? '')
        if (!cancelled && em) setMuscles(em as MuscleRole[])
      })
    return () => { cancelled = true }
  }, [slug])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const prettyMuscle = (s: string) => s.replace(/-/g, ' ')

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 120, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${name} details`}
        onClick={(e) => e.stopPropagation()}
        style={{ width: '100%', maxWidth: 560, maxHeight: '85vh', overflowY: 'auto', background: '#161618', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '16px 16px 0 0', padding: 20 }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700, color: '#F5F5F5' }}>{name}</h3>
          <button onClick={onClose} aria-label="Close" style={{ width: 36, height: 36, minHeight: 36, borderRadius: '50%', border: '1px solid rgba(255,255,255,0.14)', background: 'rgba(0,0,0,0.35)', color: '#D4D4D8', cursor: 'pointer' }}>✕</button>
        </div>

        {error && <p role="alert" style={{ color: '#EF4444', fontSize: '0.85rem' }}>{error}</p>}
        {!detail && !error && <p style={{ color: '#A1A1AA', fontSize: '0.85rem' }}>Loading…</p>}

        {detail && (
          <>
            {detail.video_url ? (
              <video src={detail.video_url} poster={detail.poster_url ?? undefined} muted loop playsInline autoPlay controls={false} style={{ width: '100%', aspectRatio: '16 / 10', objectFit: 'cover', borderRadius: 10, background: '#0A0A0B', marginBottom: 14 }} />
            ) : detail.poster_url ? (
              <img src={detail.poster_url} alt="" style={{ width: '100%', aspectRatio: '16 / 10', objectFit: 'cover', borderRadius: 10, background: '#0A0A0B', marginBottom: 14 }} />
            ) : null}

            {(detail.sets || detail.hold_seconds) && (
              <p style={{ fontSize: '0.8rem', color: '#818CF8', margin: '0 0 10px' }}>
                {detail.sets && `${detail.sets} sets`}{detail.sets && detail.hold_seconds && ' · '}{detail.hold_seconds && `${detail.hold_seconds}s hold`}
              </p>
            )}
            {detail.instructions && (
              <p style={{ fontSize: '0.88rem', color: '#D4D4D8', lineHeight: 1.6, margin: '0 0 14px' }}>{detail.instructions}</p>
            )}
            {muscles.length > 0 && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {muscles.map((m) => (
                  <span key={m.muscle_slug} style={{ padding: '2px 10px', borderRadius: 20, fontSize: '0.7rem', fontWeight: 600, textTransform: 'capitalize', background: m.role === 'stretch' ? 'rgba(16,185,129,0.15)' : 'rgba(99,102,241,0.15)', color: m.role === 'stretch' ? '#34D399' : '#818CF8' }}>
                    {prettyMuscle(m.muscle_slug)} · {m.role}
                  </span>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
```

(If the double-query for `exercise_id` proves awkward, an equivalent single call `supabase.from('exercises').select('id, name, …, exercise_muscles(muscle_slug, role)')` with a foreign-table select is fine — keep whichever works against the live schema.)

- [ ] **Step 2: Wire into PriorityProgram**

In `PriorityProgram.tsx`: import the sheet and `useState`; in the default export add `const [detail, setDetail] = useState<{ slug: string; name: string } | null>(null)`, render `{detail && <ExerciseDetailSheet slug={detail.slug} name={detail.name} onClose={() => setDetail(null)} />}` at the end of the root div, and thread an `onOpenDetail: (slug: string, name: string) => void` prop down `PriorityCard → RampTable`. In `RampTable`, replace the name span (line 140) with:

```tsx
                    <button
                      data-testid={`exercise-detail-${s.slug}`}
                      onClick={() => onOpenDetail(s.slug, s.name)}
                      style={{ background: 'none', border: 'none', padding: 0, fontWeight: 600, color: '#F5F5F5', fontSize: 'inherit', cursor: 'pointer', textDecoration: 'underline dotted rgba(255,255,255,0.3)', textUnderlineOffset: 3 }}
                    >
                      {s.name}
                    </button>
```

- [ ] **Step 3: E2E check**

Add to the existing results-page spec (find it: `grep -l "priority-card" e2e/*.spec.ts`) a test: click `[data-testid^="exercise-detail-"]` (first match) → expect `role=dialog` visible with the exercise name → press Escape → dialog gone.

- [ ] **Step 4: Full verify + land Phase 3**

```bash
npx vitest run && npx playwright test
git add app/assessments/[id]/ExerciseDetailSheet.tsx app/assessments/[id]/PriorityProgram.tsx e2e/
git commit -m "feat: exercise detail sheet with demo media on results program"
~/bin/zs-land
```

---

## Phase 4: MoveKit coverage gate → clips (branch `feat/movekit-clips`)

### Task 18: Coverage check — STOP GATE before purchase

**Files:**
- Create: `scripts/movekit-coverage.mjs`
- Create (fallback input): `data/movekit-catalog.txt`

- [ ] **Step 1: Obtain MoveKit's exercise list**

Try in order: (a) fetch `https://movekit.com` and look for a catalog/demo-list page or JSON the site loads; (b) their docs/FAQ listing clip names; (c) if the site resists scripted fetch, load it in a browser and paste the visible exercise list into `data/movekit-catalog.txt`, one name per line. Any of the three is fine — the artifact is a plain-text name list.

- [ ] **Step 2: Write the matcher**

```js
// Compares MoveKit's clip catalog against our 55 exercise names.
// Usage: node scripts/movekit-coverage.mjs data/movekit-catalog.txt
import { readFileSync, readdirSync } from 'node:fs'

const catalog = readFileSync(process.argv[2] ?? 'data/movekit-catalog.txt', 'utf8')
  .split('\n').map((l) => l.trim().toLowerCase()).filter(Boolean)

const norm = (s) => s.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ')
// Synonyms bridge PT naming vs gym naming.
const SYNONYMS = {
  'chin tucks': ['chin tuck', 'neck retraction', 'cervical retraction'],
  'wall angels': ['wall angel', 'wall slide'],
  'push up plus': ['push-up plus', 'scapular push up', 'scapula push up'],
  'prone y raise': ['y raise', 'prone y'],
  'prone t raise': ['t raise', 'prone t', 'reverse fly floor'],
  'supine pelvic tilt': ['pelvic tilt'],
  'terminal knee extension': ['tke', 'knee extension band'],
  'dead bug': ['deadbug'],
  'bird dog': ['bird-dog', 'quadruped limb raise'],
  'clamshell': ['clam shell', 'side lying clam'],
}
const files = readdirSync('content/exercises').map((f) => f.replace('.ts', ''))
const rows = files.map((slug) => {
  const name = norm(slug.replace(/-/g, ' '))
  const cands = [name, ...(SYNONYMS[name] ?? [])].map(norm)
  const hit = catalog.find((c) => cands.some((cand) => norm(c).includes(cand) || cand.includes(norm(c))))
  return { slug, hit: hit ?? null }
})
const matched = rows.filter((r) => r.hit)
console.log(`MoveKit coverage: ${matched.length}/${rows.length}`)
console.log('\n-- MISSING --')
for (const r of rows.filter((r) => !r.hit)) console.log(r.slug)
console.log('\n-- MATCHED --')
for (const r of matched) console.log(`${r.slug}  →  ${r.hit}`)
```

- [ ] **Step 3: Run and report — then STOP**

Run: `node scripts/movekit-coverage.mjs`
**Report the matched/missing table to Devin with a buy / don't-buy recommendation (rough bar: ≥60% matched, including most stretches, is worth $99 given per-gap fill via ExerciseAnimatic ~$1/clip). DO NOT PURCHASE ANYTHING YOURSELF. Wait for Devin's decision (O4).** Commit the script regardless:

```bash
git add scripts/movekit-coverage.mjs
git commit -m "chore: movekit catalog coverage checker"
```

### Task 19 (after purchase): Prepare and upload clips

**Files:**
- Create: `scripts/upload-exercise-media.mjs`
- Create: `data/movekit-map.json` (slug → purchased clip filename; gitignored dir is fine, but this map is small — commit it under `data/` root, NOT inside `exercises-dataset/`)

- [ ] **Step 1: Build the slug→clip map**

Download the purchased library to `data/movekit-clips/` (gitignore this dir: add `data/movekit-clips/` to `.gitignore`). Write `data/movekit-map.json` from Task 18's MATCHED table: `{ "doorway-pec-stretch": "chest-doorway-stretch.mp4", ... }`. Only mapped slugs get media; unmapped slugs keep the gradient fallback (that is fine and expected).

- [ ] **Step 2: Transcode + poster per slug**

For each map entry (loop in the upload script or a shell loop):

```bash
ffmpeg -y -i "data/movekit-clips/$CLIP" -an -vf "scale=-2:720" -c:v libx264 -crf 26 -pix_fmt yuv420p -movflags +faststart "/tmp/$SLUG-loop.mp4"
ffmpeg -y -i "/tmp/$SLUG-loop.mp4" -vframes 1 -vf "scale=-2:720" "/tmp/$SLUG-poster.webp"
```

- [ ] **Step 3: Upload script (service role)**

```js
// Uploads {slug}/loop.mp4 + {slug}/poster.webp to the exercise-media bucket.
// Requires SUPABASE_SERVICE_ROLE_KEY + NEXT_PUBLIC_SUPABASE_URL in env (.env).
// Usage: node scripts/upload-exercise-media.mjs /tmp
import { createClient } from '@supabase/supabase-js'
import { readFileSync, existsSync } from 'node:fs'

const map = JSON.parse(readFileSync('data/movekit-map.json', 'utf8'))
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const dir = process.argv[2] ?? '/tmp'
for (const slug of Object.keys(map)) {
  for (const [file, type] of [[`${slug}-loop.mp4`, 'video/mp4'], [`${slug}-poster.webp`, 'image/webp']]) {
    const path = `${dir}/${file}`
    if (!existsSync(path)) { console.error(`MISSING ${path}`); process.exitCode = 1; continue }
    const dest = `${slug}/${file.replace(`${slug}-`, '')}`
    const { error } = await supabase.storage.from('exercise-media').upload(dest, readFileSync(path), { contentType: type, upsert: true })
    console.log(error ? `FAIL ${dest}: ${error.message}` : `ok ${dest}`)
    if (error) process.exitCode = 1
  }
}
```

- [ ] **Step 4: Verify a public URL**

```bash
curl -sI "https://dhrkezfypzutiwtmcmof.supabase.co/storage/v1/object/public/exercise-media/doorway-pec-stretch/poster.webp" | head -3
```
Expected: `HTTP/2 200`, `content-type: image/webp` (for any uploaded slug).

- [ ] **Step 5: Commit**

```bash
git add scripts/upload-exercise-media.mjs data/movekit-map.json .gitignore
git commit -m "feat: exercise media transcode and upload pipeline"
```

### Task 20: Author `media` blocks + reseed + verify

- [ ] **Step 1: Add `media` to each mapped content file** (after `form`):

```ts
  media: {
    loopUrl: 'https://dhrkezfypzutiwtmcmof.supabase.co/storage/v1/object/public/exercise-media/<slug>/loop.mp4',
    posterUrl: 'https://dhrkezfypzutiwtmcmof.supabase.co/storage/v1/object/public/exercise-media/<slug>/poster.webp',
  },
```

(Mechanical: a small one-off node script over `data/movekit-map.json` keys is acceptable; verify with `npx vitest run content`.)

- [ ] **Step 2: Regenerate + apply the KB seed**

```bash
npx vite-node scripts/generate-muscle-seed.ts > supabase/migrations/20260704100000_exercise_media_seed.sql
```
Apply via the RUNBOOK Management API procedure. Verify: `/exercises` now shows thumbnails for mapped slugs; the detail sheet plays loops.

- [ ] **Step 3: Full verify + land Phase 4**

```bash
npx vitest run && npx playwright test
```
Manual: run a full workout session — clips render with scrim, next-clip preloads (Network tab), an unmapped slug still shows the gradient.

```bash
git add content/exercises supabase/migrations/20260704100000_exercise_media_seed.sql
git commit -m "feat: wire movekit demo loops into exercise content and KB seed"
~/bin/zs-land
```

---

## Phase 5: Exercise bank expansion (branch `feat/exercise-bank-expansion`)

### Task 21: Shortlist candidates — approval gate

**Files:**
- Create: `scripts/dataset-shortlist.mjs`

- [ ] **Step 1: Write the shortlist script**

```js
// Candidate posture-relevant exercises from the reference dataset:
// bodyweight/band only, posture-adjacent categories or corrective name keywords.
// Output is a REVIEW list for Devin — nothing is imported automatically.
import { readFileSync } from 'node:fs'
const all = JSON.parse(readFileSync('data/exercises-dataset/data/exercises.json', 'utf8'))
const EQUIP = new Set(['body weight', 'band', 'resistance band', 'roller', 'stability ball'])
const CATS = new Set(['back', 'waist', 'shoulders', 'neck', 'upper legs', 'lower legs'])
const KEYWORDS = /stretch|bridge|plank|row|raise|tuck|rotation|pull-up|superman|hyperextension|good morning|bird|dead bug|clam/i
const hits = all.filter((e) => EQUIP.has(e.equipment) && (CATS.has(e.category) || KEYWORDS.test(e.name)))
console.log(`${hits.length} candidates\n`)
for (const h of hits) console.log(`${h.id}\t${h.category}\t${h.equipment}\t${h.name}\t[${h.target} / ${h.muscle_group}]`)
```

- [ ] **Step 2: Run, curate, get approval — STOP GATE**

Run: `node scripts/dataset-shortlist.mjs | head -100`. From the output pick **15–20** that (a) fill swap gaps — check which `primaryDeviationKeys` have the fewest exercises: `grep -h "primaryDeviationKeys" content/exercises/*.ts | sort | uniq -c | sort -n`; (b) need no equipment beyond band/bodyweight; (c) are movements a screening app can coach safely (no loaded spinal flexion, no ballistic work). **Present the picked list with one-line rationale each to Devin for approval before authoring.** Commit the script.

### Task 22: Author the approved exercises

- [ ] **Step 1: One content file per approved exercise**, modeled exactly on `content/exercises/glute-bridge.ts` + the Phase 2 worked example. Every field required: kebab-case slug, name (our naming, not the dataset's), category, `primaryDeviationKeys` (from the swap-gap analysis), `minZone`, own-words `instructions` (80–800 chars), sets/holdSeconds/dosageType/reps (respect the schema's superRefine: `reps: null` for hold/stretch), `muscles` (valid slugs only — list them: `grep -h "slug:" content/muscles/*.ts | sort`), plus `steps` + `form` per Phase 2 rules. Dataset text is reference-only.

- [ ] **Step 2: Regenerate the index + validate**

```bash
node scripts/generate-content-index.mjs
npx vitest run content
```
Expected: PASS — including `exercise-coverage.test.ts` (new files must ship with form/steps) and the registry match tests.

- [ ] **Step 3: Reseed + full verify + land Phase 5**

```bash
npx vite-node scripts/generate-muscle-seed.ts > supabase/migrations/20260705000000_exercise_bank_expansion_seed.sql
# apply via RUNBOOK Management API procedure
npx vitest run && npx playwright test
git add content/ supabase/migrations/20260705000000_exercise_bank_expansion_seed.sql
git commit -m "feat: expand exercise bank with curated posture-relevant movements"
~/bin/zs-land
```

---

## Decision log & gates

| Gate | Where | Who decides |
|---|---|---|
| O4 — MoveKit $99 purchase | End of Task 18 (coverage report) | Devin |
| Shortlist approval | Task 21 Step 2 | Devin |
| Escalation | Any task failing after 2 honest attempts (most likely: Task 18 scrape, Task 17 foreign-table select) | Stop, report, escalate model |
