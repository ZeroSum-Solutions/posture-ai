import type { PoseFrame } from '@posture-ai/engine/types'
import type { FrameQuality } from '@/lib/pose/quality'

/** Engine/detection view — what `detectPose` and `assessFrameQuality` consume. */
export type ViewKey = 'front' | 'side' | 'back'

/**
 * Capture-flow slot. The side view is captured as two independent slots (the
 * left and right profiles), so the flow has four slots even though the engine
 * still sees three views. `slotToDomain` bridges the two.
 */
export type CaptureSlotKey = 'front' | 'side-left' | 'side-right' | 'back'

// Per-slot quality state
export type SlotStatus = 'idle' | 'checking' | 'ok' | 'no_person' | 'warnings'

export interface CaptureSlot {
  file: File | null
  preview: string | null
  source: 'upload' | 'camera' | null
  poseFrame: PoseFrame | null
  quality: FrameQuality | null
  slotStatus: SlotStatus
  /** Sensor-measured camera roll for camera captures; null for uploads/no-sensor. */
  captureRollDeg: number | null
  /**
   * Camera capture burst — the stills grabbed at the shutter (engine 1.3.0
   * within-capture stability). `preview` is the representative one; every frame
   * is pose-detected at submit so the engine can median them + score stability.
   * null for uploads (a single image can't estimate within-capture jitter).
   */
  burstPreviews: string[] | null
  /**
   * Immutable id stamped at the shutter for this slot's current capture. Async
   * preflight keys off it so a result from a superseded capture (e.g. the user
   * retook mid-flight) is discarded instead of mis-associated.
   */
  captureId: number | null
}

export type Captures = Record<CaptureSlotKey, CaptureSlot>

/** Canonical slot iteration/display order. */
export const SLOT_ORDER: CaptureSlotKey[] = ['front', 'side-left', 'side-right', 'back']

/** Slots that must be captured before analysis; back is optional. */
export const REQUIRED_SLOTS: CaptureSlotKey[] = ['front', 'side-left', 'side-right']

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
    file: null, preview: null, source: null, poseFrame: null, quality: null,
    slotStatus: 'idle', captureRollDeg: null, burstPreviews: null, captureId: null,
  }
}
