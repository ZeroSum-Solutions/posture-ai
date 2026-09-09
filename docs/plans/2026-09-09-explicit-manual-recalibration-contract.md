# Explicit manual recalibration contract

This checkpoint covers the `effort_too_easy_recalibration` result produced when a completed working set records `6_plus` RIR. It does not turn that observation into an automatic progression or a safety claim.

## Accepted behavior

- The server binds the offer to the latest applicable completed source session, exercise instance, session revision, progression decision identity and ordered source-exposure revision IDs. The source decision must have the exact reason `effort_too_easy_recalibration` and must match the current program's subject, assignment, exercise version, progression series and load epoch.
- The server revalidates the current immutable program revision and hash, current profile revision, current eligibility source and effective window, exact execution context, catalog origin/version and dedicated bodyweight/assistance policy before returning options.
- Options are exact settings enumerated from the current saved equipment inventory and bounded by the exact catalog compatibility. No numeric setting is inferred between saved denominations and no option is selected by default.
- A harder setting means a strictly higher resistance or bodyweight-external load, or strictly lower machine assistance. Every retained authored warm-up remains no harder than the selected working setting. Warm-ups are preserved exactly; the engine does not recalculate or discard them.
- Every option requires explicit unit, load-basis and equipment confirmation. For resistance and bodyweight-external increases, the engine recomputes the exact greater-than-20-percent comparison from the source decision's last comparable actual load, which is carried as an immutable server binding and may differ from the accepted prescription. Exactly 20 percent is not an outlier. A zero prior load uses explicit calibration rather than division. The acceptance layer must rederive that baseline and require the corresponding acknowledgement; a browser flag is not proof.
- Selection produces a `selected_not_applied` value. Acceptance is a later authenticated transaction. On acceptance, only future scheduled and unprescribed instances in the same authored series may change; completed, started and already-prescribed history stays immutable. The accepted setting starts a new progression series and increments the load epoch exactly once.
- Self-directed acceptance belongs to the subject owner. For coach-assigned programs the athlete may request/review but the owning currently authorized coach accepts. Exact replay, changed-payload conflict, current authority, source staleness and execution-context separation remain persistence requirements.

## Deliberate limits

This pure checkpoint does not persist or accept a recalibration, alter a program, consume progression evidence, choose a setting, reduce sets, change exercises, or activate a live catalog. A later persistence/API checkpoint must rederive the source and options, enforce the outlier acknowledgement, and compare the chosen option by exact index and value before applying a future-only revision.
