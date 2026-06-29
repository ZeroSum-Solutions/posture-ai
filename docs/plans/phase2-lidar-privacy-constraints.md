# Phase-2 (iOS LIDAR) — Privacy & Compliance Constraints

Binding design constraints for the Phase-2 iOS capture kit (LIDAR depth). Depth
sensing raises the privacy stakes versus Phase-1's 2D pose, so the guarantees we
built in Phase-1 must be preserved — not re-litigated — when LIDAR lands.

## Non-negotiables (carry forward from Phase-1)

1. **No face geometry, ever.** Do not run ARKit `ARFaceTrackingConfiguration`,
   face meshes, or any face-landmark/identity model. Use body/skeleton + depth
   only. Mirror the Phase-1 `assertPoseOnlyModel` guard: a checked, logged,
   fail-closed code path on the native side, not a policy promise.
2. **On-device processing, no raw frames at rest.** RGB frames and the raw LIDAR
   depth map are processed on-device and discarded immediately. Only derived
   body-position measurements leave the device. No image/point-cloud bytes are
   persisted or transmitted (the `captures.storage_path IS NULL` invariant holds).
3. **Depth-point minimization.** Persist only the body-landmark coordinates (and
   derived metrics) actually used for scoring — never a dense point cloud, and
   never face-region points (indices 0–10 equivalents). Strip before persistence,
   as `stripFaceLandmarks` does today.
4. **Same consent + age gate.** Reuse the subject-consent record + age policy
   (under-13 blocked; 13–17 guardian) and the server capture gate. A LIDAR
   capture is still a capture — it must pass the same `captureEligibility` check.
5. **Same intended-use posture.** Practitioner-only; professional review before
   export; screening (not diagnostic) vocabulary. No consumer flag-and-prescribe.

## To revisit with counsel before Phase-2 ships
- Whether high-resolution depth of the body raises new biometric-identifier
  questions under BIPA / state law (gait, body-geometry).
- BAA scope if LIDAR kits are deployed in covered-entity clinics.
- Updated consent wording describing depth capture.

## Implementation note
Phase-2 should depend on the Phase-1 primitives, not fork them: the consent
records, age library, capture-eligibility gate, and no-face guard are the shared
contract. New native code calls the same server gate (`POST /api/assessments`).
