# Posture AI UI optimization plans

This series turns the July 2026 UI audit into a bounded, repeatable implementation loop. Execute the plans in order because later visual work depends on the interaction and data contracts established earlier.

## Loop contract

Each pass follows the same sequence:

1. **Observe** — run the production build against synthetic local data and capture fresh screenshots at 320, 375, 414, 768, 1024, and 1440 px.
2. **Choose** — work one category only: correctness/safety, assessment workbench, client evidence canvas, or cross-surface polish.
3. **Act** — make the smallest coherent source and test changes for that category. Preserve screening vocabulary, approval gates, deterministic engine output, and `DESIGN.md`.
4. **Verify** — run targeted tests first, then typecheck, lint, unit tests, build, browser assertions, keyboard checks, and screenshot review.
5. **Record** — append the evidence and disposition to `docs/qa/PASS-0N.md` and update `docs/qa/BUGLOG.md` / `docs/qa/INVENTORY.md` when applicable.

Stop with exactly one terminal state:

- `CLEAN`: acceptance criteria and all required gates pass.
- `BLOCKED`: an external dependency or real-device-only requirement prevents progress.
- `APPROVAL_REQUIRED`: the next action needs product, clinical, security, or deployment authority.
- `STAGNATED`: two consecutive passes produce no material reduction in accepted findings.
- `EXHAUSTED`: four implementation passes completed without reaching `CLEAN`.

An executor implements each pass in an isolated worktree. The root advisor reviews the diff against the plan. A separate verifier performs the final acceptance run.

## Ordered plans

| Plan | Focus | Depends on |
| --- | --- | --- |
| [001-ui-truth-and-safety.md](001-ui-truth-and-safety.md) | Race-safe assessment actions, truthful comparison/dashboard states, baseline a11y/tests | — |
| [002-assessment-review-studio.md](002-assessment-review-studio.md) | Persistent assessment evidence workspace and action dock | 001 |
| [003-client-evidence-canvas.md](003-client-evidence-canvas.md) | Responsive Progress/Compare canvas, disciplined charts and data cards | 001 |
| [004-cross-surface-polish-and-verification.md](004-cross-surface-polish-and-verification.md) | Motion, 44 px targets, GPU suspension, decorative cleanup, final QA | 002, 003 |

## Explicit non-goals

- No CopilotKit, AG-UI, Google ADK, Gemini, Python service, or runtime LLM feature.
- No copied React Bits implementation or dependency bundle. Reimplement only the useful interaction ideas with current dependencies and native semantics.
- No changes to posture scoring, thresholds, program generation, clinical language, or content under `docs/evidence/**`.
- No font, black-canvas, glass-material, or global brand rewrite; those are settled in `DESIGN.md`.
- No deployment, merge, or production data access in this series.
