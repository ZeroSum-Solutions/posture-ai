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
