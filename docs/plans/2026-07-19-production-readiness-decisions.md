# Production-readiness decision record

**Recorded:** 2026-07-19
**Status:** launch boundary accepted; launch not authorized
**Feeds:** HG-00 and PR-00 in `2026-07-19-production-readiness-goal-spec.md`

## Owner-confirmed decisions

| ID | Decision | Recorded answer | Enforcement effect |
|---|---|---|---|
| DEC-01 | First milestone | Invite-only practitioner beta | Disable public admission. Billing, public/paid launch, native Expo, and broader consumer scope remain excluded. |
| DEC-02 | HIPAA boundary | Non-HIPAA fitness/wellness cohort | Covered entities are not admitted. Any exception requires a formal scope revision, new council review, and completion of the conditional HIPAA/BAA gates. |
| DEC-03 | Clinical reviewer | A licensed clinician is available | Availability does not activate content. HG-03 passes only with an itemized signed review of muscles, exercises, links, evidence scope, and contraindications. Until then, recommendation/program/workout/knowledge-link surfaces remain server-disabled for the beta. |

## Retained release-control boundary

Production promotion remains manual and approval-required. Autonomous work may prepare and verify a release candidate, but it may not deploy, migrate production, change provider configuration, or describe the product as launch-authorized. HG-10 requires the owner's explicit approval after HG-09's intended-configuration rehearsal and final council.

## Scope-change rule

Changing any answer above invalidates the affected applicability/configuration hash. PR-00 must regenerate the production-readiness manifest, affected tasks must be re-audited, and the final intended-configuration rehearsal must be repeated before launch authorization.
