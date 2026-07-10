# Agent instructions — posture-ai

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
