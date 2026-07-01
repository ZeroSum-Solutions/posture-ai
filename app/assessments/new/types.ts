import type { PoseFrame } from '@posture-ai/engine/types'
import type { FrameQuality } from '@/lib/pose/quality'

export type ViewKey = 'front' | 'side' | 'back'

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
}

export type Captures = Record<ViewKey, CaptureSlot>

export const VIEW_ORDER: ViewKey[] = ['front', 'side', 'back']

export const VIEW_LABEL: Record<ViewKey, string> = {
  front: 'Front View',
  side: 'Side View',
  back: 'Back View',
}
