# Posture AI application completion goal

Requested by Devin on September 8, 2026. Execute autonomously within the existing application. This document organizes the approved [strength and conditioning PRD](2026-09-07-strength-conditioning-prd.md); it does not replace or reduce its requirements. Latest owner direction: finish the features, then batch publishing later.

## Objective

Complete and verify the original Posture AI experience from screening evidence through building a workout, following it, recording performance, understanding future targets, and resuming across interruptions and devices. Preserve existing accounts, assessments, photographs, historical prescriptions, worktrees and unfinished work. Do not create a separate demo application.

## Execution order and completion criteria

1. **Exercise selection and durable routines (MR-01–06).** Users can search at least 250 distinct exercises, select/order/remove them, enter their own strength sets/reps/exact decimal loads and units or conditioning durations, and save/reopen/edit/archive a routine. Saved exercise instructions and attribution remain associated with the routine. Owner and permissioned-coach access work; unrelated actors are denied. Exact retries do not duplicate routines and stale edits produce a visible conflict. Native Workouts navigation exposes this flow.
2. **Reliable execution and logging (DA-01–04, UX-02–03).** Set, conditioning and completion requests preserve exact retry identity and payload after an ambiguous response. In-flight controls prevent conflicting edits. Acknowledgements, unconfirmed saves and revision conflicts are distinct. Actuals survive refresh/resume. Athlete/coach concurrent writes preserve history and expose conflicts.
3. **Complete programmed strength and conditioning (all PR and CO criteria).** Verify 4/6/8/12-week cycles, self-directed and coach-assigned authority, exact load semantics and microplate increments, comparable performance tracks, explicit progression acceptance, conditioning and the specified edge cases. Connect eligible authored exercises to the real program flow. Do not count a searchable reference library or a four-exercise synthetic practice fixture as completion of the full programmed experience. Preserve the PRD review prerequisites without inventing approval.
4. **Screening and exercise presentation (SC-01–07, ME-01–02).** Verify actual selected capture-image retention and view association, unavailable historical photos, capture/save failures, observable scan interpretation, accessible 3D navigation and rendering, and exact exercise-media attribution/fallbacks. Fix demonstrated software errors. Scientific validity requires its stated evidence and cannot be inferred from unit tests or a polished model.
5. **Integrated offline and multi-device behavior (Wave 4, DA-01–04).** Persist scoped exact mutation envelopes through reload, reconnect in order, deduplicate acknowledgements, stop for conflicts rather than silently rebasing, and enforce logout/account-change/erasure/expiry handling. Integrate storage, HTTP outcomes and visible UI states; a tested queue module alone is not completion.
6. **Integration and final verification (all PRD criteria).** Exercise the populated original app on desktop and mobile browser layouts, test keyboard and failure states, run necessary integration gates, and record exact source revisions and proof artifacts. Keep physical-device and human usability requirements explicit until actually performed. Resolve consequential independent review findings.

## Execution rules

- Continue the existing workers and partial work; inspect before replacing anything. Integrate bounded changes into the owning worktree.
- Parallel lanes: manual-routine backend, manual-routine UI, and offline/retry handling. The orchestrator owns shared integration, navigation, conflicting changes and verification.
- Use the existing pinned Node runtime and package tooling. Run focused checks while editing, then relevant integration gates. Preserve Blacksmith runner choices. Do not repeatedly run whole audits or cancel healthy CI for small changes.
- Use the purchased Grok 4.6 subscription for necessary independent reviews at consequential integration boundaries. The owner's instruction to audit only when needed overrides the goal skill's older every-task audit rule and older Grok routing.
- Keep incomplete and uncertain criteria incomplete. Record evidence per criterion, not just a count of passing tests. Do not mark the overall goal complete because a smaller demo works.
- Do not deploy, assign the production alias, or push just to trigger a release now. Publishing remains an explicit deferred phase under the owner's latest instruction. Prepare a coherent release candidate locally and retain the eventual exact-deployment verification requirement.
- Do not consume a usage-reset credit without explicit authorization. A provider usage interruption does not justify discarding work or claiming completion.

## Completion accounting

The implementation milestone is complete only when all independently executable requirements above and in the PRD are implemented and verified. Any remaining qualified review, real-device test, human evaluation or scientific validation must be identified precisely with the affected criterion and evidence needed; it is not a pass. The full original goal also includes publishing and production verification, which remain deferred by the owner and must not be reported complete.

Canonical existing execution state: `/Users/zero-suminc./.claude/goal-state/posture-ai-strength-conditioning/state.json`. Preserve earlier proof. Track this execution revision in that state rather than creating a competing worker history.
