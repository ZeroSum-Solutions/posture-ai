import type { PoseFrame } from '@posture-ai/engine/types'
import type { PoseInputProvenance } from '@/lib/pose/detect'
import type { Captures, CaptureSlotKey, ViewKey } from './types'
import { SLOT_ORDER, slotToDomain, isCaptured } from './types'

/**
 * A pure description of how one captured slot contributes to the submit payload,
 * decided BEFORE any async detection so it is unit-testable. Exactly one of
 * `burstUrls` / `cachedFrame` / `fallbackUrl` is set. Every entry carries the
 * slot's engine view + side profile so the executor stamps laterality correctly.
 */
export interface SlotFramePlan {
  slot: CaptureSlotKey
  view: ViewKey
  profileSide?: 'left' | 'right'
  roll: number | null
  source: 'upload' | 'camera' | null
  poseInput: PoseInputProvenance | null
  /** Camera burst: detect every raw frame (>1). */
  burstUrls: string[] | null
  /** Preflight already detected this raw frame (carries profileSide); push as-is. */
  cachedFrame: PoseFrame | null
  /** No burst/cache (upload or failed preflight): detect this raw still once. */
  fallbackUrl: string | null
}

/**
 * Build the per-slot submission plan from the raw detection channel only. Reads
 * `rawBurstUrls`/`rawPoseFrame`/`rawRepresentativeUrl` — never the display
 * channel — so a corrected display image can never reach detection (design §4.3).
 */
export function buildFramePlan(captures: Captures): SlotFramePlan[] {
  const plan: SlotFramePlan[] = []
  for (const slot of SLOT_ORDER) {
    const cap = captures[slot]
    if (!isCaptured(cap)) continue
    const { view, profileSide } = slotToDomain(slot)
    const burstUrls = cap.source === 'camera' && cap.rawBurstUrls && cap.rawBurstUrls.length > 1
      ? cap.rawBurstUrls
      : null
    plan.push({
      slot, view, profileSide, roll: cap.captureRollDeg, source: cap.source,
      poseInput: cap.poseInput,
      burstUrls,
      cachedFrame: burstUrls ? null : cap.rawPoseFrame,
      fallbackUrl: burstUrls || cap.rawPoseFrame ? null : cap.rawRepresentativeUrl,
    })
  }
  return plan
}

/** Stamp the slot's side profile (and roll) onto a freshly-detected frame. */
export function stampFrame(
  f: PoseFrame,
  profileSide: 'left' | 'right' | undefined,
  roll: number | null,
): PoseFrame {
  const scoringFrame = toScoringFrame(f)
  return {
    ...scoringFrame,
    ...(profileSide ? { profileSide } : {}),
    ...(roll !== null ? { captureRollDeg: roll } : {}),
  }
}

/** Remove client-only detection metadata before POSTing to the strict API schema. */
export function toScoringFrame(
  frame: PoseFrame & { detectedPoseCount?: number },
): PoseFrame {
  const { detectedPoseCount, ...scoringFrame } = frame
  void detectedPoseCount
  return scoringFrame
}
