# Agent instructions — posture-ai

## External model routing

- **Kimi K3 is approved for this project** through the prepaid Moonshot lane documented in
  `~/AGENTS.md`. Invoke it from the repository with `kimi-k3 --oneshot "<self-contained task>"`.
- Kimi K3 is external to Codex. Do **not** pass `Kimi K3` or `kimi-k3` as the `model` value
  for Codex's built-in collaboration/subagent tools; those selectors only accept their
  explicitly listed Codex models.
- Long Kimi reviews can spend several minutes in provider-side synthesis. The wrapper emits
  progress heartbeats while preserving the final answer on stdout; a quiet interval is not
  by itself an authentication failure.

## `docs/evidence/**` is opt-in

That directory holds the literature reviews backing the engine's degree thresholds and the
muscle-link confidence gradings. It is the densest biomedical text in this repo, and models
that run a life-sciences safety classifier over the request context will usually refuse and
fall back when it is loaded.

Read a single file when you need to verify a single citation. Do **not** bulk-load the
directory or sweep it in repo-wide searches. To summarize it, dispatch a subagent and take
its report rather than pulling the raw text into your own context.

See `docs/evidence/README.md` for what maps to what, and why a `low` confidence tier is a
finding rather than a gap.

## Where else to look

- `docs/RUNBOOK.md` — environment, deploys, security posture.
- `docs/coherence-debt.md` — the exercise↔finding coherence ledger and its enforced gate.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
