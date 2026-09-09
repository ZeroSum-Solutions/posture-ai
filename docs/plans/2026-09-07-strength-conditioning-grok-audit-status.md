# Grok 4.6 audit status

**Completed through purchased SuperGrok OAuth on 2026-09-07.** See [external review](2026-09-07-strength-conditioning-grok-review.md). Initial OpenRouter credits failure below is historical and no longer blocks the audit.

## Earlier attempt

# Grok 4.6 audit status

Status: **not run — provider credits blocked the complete input**.

Requested external model: `x-ai/grok-4.6`, verified in the live OpenRouter catalog. No other model was substituted, and no Grok verdict was returned.

OpenRouter returned HTTP 402 for the document bundle and reduced-output retries. The final full-PRD-only request required 15,868 input tokens; the account allowed 10,480. Its output allowance was 3,493 tokens. Reducing output alone did not raise the input allowance. The prepaid Nous model-catalog endpoint returned HTTP 403, so no alternative Grok availability was established there.

No credits were purchased. No plan changes were made based on an unperformed audit. To resume: add OpenRouter credits or provide a working authorized Grok 4.6 route, then run the independent review against the full PRD and supporting annexes, withholding the prior Sol verdict to reduce anchoring. Preserve returned model ID, input hashes, finish reason and usage; triage findings against the actual documents before revising the PRD.
