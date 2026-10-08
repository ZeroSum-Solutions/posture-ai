# Array v4 — data visualisation decisions

Decided by the coordinator after a debate round with GPT-6 Sol and Gemini 3.1 Pro
(2026-10-07). Rule: **quantities are read by position on a labelled scale; colour
only reinforces.** Severity always reads as word + beads (`Maintain ●○○`,
`Monitor ●●○`, `Review ●●●`). Every chart has a text equivalent and 44px controls.

| # | Question | Form | Notes |
|---|---|---|---|
| A | One finding | **Finding readout**: name; value + unit (title, tabular); word + beads; a 16px **threshold scale** with printed cutoffs and one marker at this scan; `was 2.8° · 14 Sep` with ↑/↓ as text | Scale only when the measure has a finite display range; signed measures centre zero; open-ended Review shows the cutoff in text. No ghost-marker pile-ups. |
| B | Findings in a scan | **Three equal filter tiles** (Review · Monitor · Maintain): count on line 1, word + beads on line 2; zero counts stay visible; tap filters the list, tap again clears | Replaces the stack bar (thin segments are untappable). |
| C | Deviation score | **Hero numeral** (72px) with a **slot reveal** (each digit slides into place once; never counts through unrecorded values) + a full-width **linear scale** 0–100 with the score bands' numeric cutoffs and one volt marker | Replaces the 270° arc (angle reads worse than position). Reduced motion: no reveal. |
| D | Change across scans | **Trend plot** 180px tall, real dates on x, fixed 0–100 y with 0/50/100 ticks, band fields labelled on the right edge; comparable scans connected, a gap across non-comparable ones; flagged scans are a diamond with `!`; tap/scrub snaps to the nearest scan, plus 44px Previous/Next and a readout line | The selected scan's marker is volt. |
| E | Program priority | **Numbered rows** `01 02 03` (64px), first expanded; inside: focus area, related finding with word + beads, Details | "Selected", never "current"; no causal wording. |
| F | Today workload | **Hero count** `11 reports waiting` + the **three oldest** as rows: name, exact wait (`10 wk`), received date, open; `View all 11` | No relative bars (no approved time target). |
| G | Client row | Plain avatar; name; `Latest scan · 7 Oct`; most urgent category `Review ●●● · 2` | Rings around avatars are unreadable at list size. |
| H | Findings over time (client) | **Finding history matrix**: sticky 112px finding column × last 3–4 scans (80×56 cells), each cell word-initial + beads; `—` for no result; tap a cell for value/date/quality | Replaces tiny per-finding sparklines and "recorded severity readings". |
| I | Left/right pairs | **Bilateral barbell**: one row per paired measure, centre zero axis, L dot and R square joined by a line; offset shows direction and size | Used only where the engine reports a left/right pair. |

Motion: charts draw their line once on first view (path length, `glide`), markers
spring into place (`snap`); selection moves with `snap`; nothing loops. Reduced
motion: static.
