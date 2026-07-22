# QA Loop — Iteration 8 (PASS-08) — DEVICE + ACCESSIBILITY RELEASE HARNESS

**Date:** 2026-07-21

**Scope:** Mechanical device-evidence validation, accessibility receipts, mobile
capture recovery, and immutable release-inventory binding for the invite-only
responsive-web beta.

**Verdict:** **PASS (engineering harness)** — the automated harness is complete and
fail-closed. This verdict does not claim that physical iPhone or Android testing has
occurred and does not authorize launch. `HG-04` remains frozen until its physical
matrix, signed independent review, and explicit human transition are complete.

## Implemented

- Added a canonical physical-device contract, JSON schema, operator checklist, and
  raw-byte validator. Fixture mode can prove validator mechanics but can never set
  `physical_packet_valid` or `hg04_launch_eligible`.
- Bound physical receipts to exact release configuration, browser identity, run and
  artifact chronology, external evidence roots, byte lengths, SHA-256 hashes,
  sustained-session samples, capability probes, and approved reviewer keys.
- Added desktop Chromium, mobile WebKit, and explicitly labelled Android Chromium
  proxy lanes. Browser emulation is never accepted as physical-device evidence.
- Added exact skip IDs and annotation-count checks, sanitized Playwright receipts,
  and 73 unique Axe targets whose materialized set must match the frozen manifest.
- Hardened mobile capture lifecycle behavior across overlapping camera requests,
  visibility changes, countdowns, bursts, encoding failures, slot ownership,
  uploads, retakes, and Analyze locking. Wake-lock requests use generation-based
  invalidation and stale sentinels are released.
- Rebound the production-readiness configuration inventory to the exact PR-08 delta;
  prior PR-00 through PR-07 acceptance semantics remain unchanged.

## Fail-first and regression evidence

- Device-validator and goal-checker tests reject schema bypasses, stale source pins,
  invalid physical roots, self-attested configuration, malformed browser identities,
  chronology errors, duration inflation, capability mismatches, copied reviews,
  incomplete configuration deltas, fixture escalation, skip reuse, Axe omissions,
  and report tampering.
- Capture lifecycle tests failed first for camera-generation races, pending wake-lock
  ownership, hidden countdown/burst work, stale slot selection, upload collisions,
  encoding exceptions, and Analyze during a retake. All are now guarded.
- The Playwright reporter fails closed for list-only or zero-execution runs,
  interrupted tests, unapproved skips, retries without disposition, missing Axe
  receipts, duplicate or unexpected targets, and stale receipt directories.

## Verification evidence

- Focused PR-08 suites: PASS, 7 files / 257 tests.
- Full Vitest suite: PASS, 179 files / 1,612 tests.
- Posture engine: PASS, 12 files / 132 tests.
- Fresh local database reset and pgTAP: PASS, 146/146; schema lint has no errors.
- Production build, type-check, inventory drift check, golden drift check, calibration
  check, 362-cue voice verification, and `git diff --check`: PASS.
- Final pre-commit browser matrix: PASS, 126 passed + 31 exactly approved skips =
  157 tests; zero retries; 73/73 Axe receipts; empty skip and accessibility failures.
- Independent GPT-5.6 Sol adversarial code review: PASS after closing all findings.
- Exact Claude Opus 4.8 post-implementation adversarial review: PASS with no
  actionable P0–P2 defect.

## Remaining honest blocker

- `HG-04`: two complete physical runs per required iPhone Safari and Android Chrome
  device class, external raw-media evidence, signed independent review, and explicit
  human gate-owner transition. No repository fixture, Playwright proxy, or this PASS
  receipt satisfies that requirement.
