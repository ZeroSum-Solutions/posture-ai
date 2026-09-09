# Claude Code task: improve the Posture AI anatomy viewer

Paste the prompt below into Claude Code. Work on the actual viewer in its own task; the Posture AI UI task is changing navigation, client summaries and linked-region buttons independently.

---

Improve the existing Posture AI anatomy viewer for fast practitioner use on an iPhone. Do not build a replacement app.

Owning viewer repository: `/Users/zero-suminc./projects/muscle-viewer`.
Host application: `/Users/zero-suminc./projects/posture-ai-worktrees/tuesday-demo`.
Read `~/AGENTS.md` and each repository's instructions, inspect branches and dirty files, and preserve all existing work. Use an isolated viewer branch/worktree. Do not edit the host application's active worktree while its UI task is running; deliver an explicit integration patch/checklist instead.

Inspect `src/scene/MuscleViewer.tsx`, `BodyModel.tsx`, `geometrySplit.ts`, `src/state/useMuscleStore.ts`, `src/App.tsx`, the muscle catalog and actual mesh coverage. The host adapter is `app/assessments/[id]/findingsToMuscleStates.ts`; the wrapper is `MuscleModel3D.tsx`. The current host deliberately sends neutral gold anatomical references. The host is adding clickable linked-region controls; coordinate rather than duplicating those controls.

Required outcomes:

1. Allow unrestricted 360-degree horizontal rotation. Constrain vertical orbit to 30 degrees above/below the normal eye-level view: polar angle 60–120 degrees. Apply this to pointer, touch, keyboard and preset/reset paths; prevent upside-down views. Preserve pinch zoom and a clear Reset action.
2. Improve the actual model's framing, lighting, materials and silhouette. Investigate the missing head/feet and visible mesh gaps before changing assets. Do not invent anatomical geometry or obtain unlicensed replacements. Preserve BodyParts3D attribution and share-alike requirements; document mesh limitations that remain.
3. Make a selected linked region easy to locate: selected label, clear highlight, optional camera orientation/focus, and a way to restore all regions. Distinguish left and right unambiguously from the subject's perspective; preserve independent sagittal geometry/materials.
4. Support separate side-specific evidence, including different roles and severities on opposite sides, only when supplied explicitly by a trustworthy host contract. Do not propagate a whole-body or bilateral association into an invented unilateral condition. Contradictory same-side inputs must remain visible or return an explicit conflict, not silently pick one.
5. Distinguish evidence types in both contract and legend. A static posture scan alone does not establish muscle tightness, weakness, inhibition or injury. Neutral assessment-linked anatomy must remain available. Role colours require separately recorded, qualified strength/length findings; severity of a posture measurement is not severity of muscle dysfunction. Unknown sides/roles must stay unknown. Do not manufacture clinical approval or remove these distinctions.
6. Add superficial/deep or stabilizer layers only for meshes with verified classification and actual coverage. Unavailable structures must be identified, not represented by another muscle. Add severity filters only when valid severity is supplied; unknown must remain separately selectable. Do not communicate state through colour alone.
7. Fit a compact client-summary preview as well as a larger assessment viewer at 320/390/430px. Keep touch targets at least 44px. Preserve demand rendering, reduced-motion behavior, failure/retry states and bounded memory use; avoid adding continuous rendering or a large new dependency without need.

Verification: test polar limits and full azimuth rotation, independent left/right materials, contradictory and unknown evidence, region selection/reset, layer coverage, severity filtering, model failure/retry, and trusted-origin/frame messaging. Run a real mobile-WebKit browser check and a desktop check. Distinguish emulation from physical-phone proof. Capture before/after screenshots and source/build hashes. Do not claim the model reconstructs a person's actual posture unless an implemented, validated deformation pipeline truly does so.

Deliver the improved viewer, focused tests, a brief coverage/limitations list, and the exact host contract changes required. Provide generated asset hashes and updates needed for `docs/qa/muscle-viewer-build.json`. Do not hand-edit minified host assets, replace the host deployment, push to production, or overwrite the active host branch. Coordinate integration after the separate UI task finishes. Keep external audits and CI runs focused on consequential changes.
