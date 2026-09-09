# Profile persistence and exact equipment checkpoint

Grok 4.6 Build, through the purchased subscription OAuth route, reviewed the complete scoped source packet and returned `end_turn`: scoped accept, no BLOCK. The packet manifest and response are retained under `work/review/profile-equipment-review*` (local evidence, not release approval).

The checkpoint adds append-only profile/eligibility evidence, database-computed hashes, explicit coach permissions and relationship revocation, plus exact single-implement dumbbell and bounded equipment enumeration. Eligibility answers do not create clearance decisions.

Two concrete residuals were repaired after review: SQL now rejects inventory denominations above 1000 canonical kg, matching the runtime contract; a non-owner coach may revoke only their own relationship, matching the application helper. Seven regressions reproduced the issues (8 failures including the downstream revoke assertion), then all 65 database checks passed with the two updated functions inside a rollback-only transaction on the isolated port-55422 test database. No database reset or production mutation occurred.

Verification: 260 integrated training tests passed before subsequent vertical-slice integration; the combined candidate subsequently passed 286 training tests, TypeScript, and scoped ESLint. The remaining helper/SQL permission vocabulary distinction is explicit: the helper does not replace RLS, and historical decision JSON is not the current pointer. Athlete admission, profile routes, program/session persistence, clinical policy validation and production release are separate unfinished scope. No new audit was run for the narrow, regression-tested residual fixes.
