import type { PoseFrame } from '@posture-ai/engine/types'
import type { FrameQuality } from '@/lib/pose/quality'
import type { PixelQualityResult } from '@/lib/capture/pixel-quality'
import type { PoseInputProvenance } from '@/lib/pose/detect'

/** Engine/detection view — what `detectPose` and `assessFrameQuality` consume. */
export type ViewKey = 'front' | 'side' | 'back'

/**
 * Capture-flow slot. The side view is captured as two independent slots (the
 * left and right profiles), so the flow has four slots even though the engine
 * still sees three views. `slotToDomain` bridges the two.
 */
export type CaptureSlotKey = 'front' | 'side-left' | 'side-right' | 'back'

// Per-slot quality state
export type SlotStatus = 'idle' | 'checking' | 'ok' | 'no_person' | 'multiple_people' | 'warnings' | 'model_error'

export interface CaptureSlot {
  file: File | null
  source: 'upload' | 'camera' | null
  quality: FrameQuality | null
  slotStatus: SlotStatus
  /** Sensor-measured camera roll for camera captures; null for uploads/no-sensor. */
  captureRollDeg: number | null
  /** Pixel-source and orientation facts stamped onto every detected frame. */
  poseInput: PoseInputProvenance | null
  /**
   * Pixel-quality metrics sampled at acquisition time (camera: the
   * representative burst frame's canvas; upload: the decoded-and-resized
   * canvas) — precomputed by the caller, never re-derived here. Null when
   * sampling/scoring failed (fails open) or hasn't run yet. T3 merges this
   * into `quality`/`slotStatus`; this slice only threads it through.
   */
  pixelQuality: PixelQualityResult | null
  /**
   * Immutable id stamped at the shutter for this slot's current capture. Async
   * work (preflight, later slices' correction) keys off it so a result from a
   * superseded capture (e.g. the user retook mid-flight) is discarded instead of
   * mis-associated.
   */
  captureId: number | null

  // ---- RAW detection channel (design §4.3) --------------------------------
  // The ONLY data that ever reaches detectPose / the submit payload. Never the
  // corrected image (Slice 4 writes correction to the display channel below), so
  // scoring stays byte-identical to an uncorrected capture.
  /** Raw representative still — the single/fallback detection source. */
  rawRepresentativeUrl: string | null
  /**
   * Raw shutter burst — every frame grabbed at the shutter (engine 1.3.0
   * within-capture stability). Pose-detected at submit so the engine can median
   * them + score stability. null for uploads (a single image can't estimate jitter).
   */
  rawBurstUrls: string[] | null
  /** Preflight-detected raw frame (carries profileSide); the cached submit path. */
  rawPoseFrame: PoseFrame | null

  // ---- DISPLAY channel ----------------------------------------------------
  /** What the thumbnail + review overlay show. In this slice === rawRepresentativeUrl;
   *  Slice 4 points it at the device-local corrected image (never detected). */
  displayPreviewUrl: string | null
}

export type Captures = Record<CaptureSlotKey, CaptureSlot>

/** Canonical slot iteration/display order. */
export const SLOT_ORDER: CaptureSlotKey[] = ['front', 'side-left', 'side-right', 'back']

/** Production beta capture contract: every directional view is required. */
export const REQUIRED_SLOTS: CaptureSlotKey[] = ['front', 'side-left', 'side-right', 'back']

export const SLOT_LABEL: Record<CaptureSlotKey, string> = {
  'front': 'Front',
  'side-left': 'Left Side',
  'side-right': 'Right Side',
  'back': 'Back',
}

/**
 * Map a capture slot to the engine view + optional side profile it represents.
 * `side-left`/`side-right` both score the `side` view but carry their laterality
 * so the POST stamps `profileSide` (Slice 1) — otherwise both sides collapse into
 * one legacy `side` group and are medianed together.
 */
export function slotToDomain(slot: CaptureSlotKey): { view: ViewKey; profileSide?: 'left' | 'right' } {
  switch (slot) {
    case 'front': return { view: 'front' }
    case 'back': return { view: 'back' }
    case 'side-left': return { view: 'side', profileSide: 'left' }
    case 'side-right': return { view: 'side', profileSide: 'right' }
  }
}

/** A fresh, idle slot. */
export function emptySlot(): CaptureSlot {
  return {
    file: null, source: null, quality: null, slotStatus: 'idle', captureRollDeg: null,
    poseInput: null,
    pixelQuality: null,
    captureId: null, rawRepresentativeUrl: null, rawBurstUrls: null, rawPoseFrame: null,
    displayPreviewUrl: null,
  }
}

/** True once this slot holds a capture (raw detection data present). */
export function isCaptured(slot: CaptureSlot): boolean {
  return slot.rawRepresentativeUrl !== null
}
