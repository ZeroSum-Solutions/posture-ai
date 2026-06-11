import { testLandmarksFrames } from '@posture-ai/engine'
import type { PoseFrame, ViewLabel } from '@posture-ai/engine'

export type AssessmentInputMode = 'fixture' | 'capture'

export interface CapturedViewImage {
  view: ViewLabel
  uri: string
  width?: number
  height?: number
  capturedAt: string
}

export interface PoseFrameSourceState {
  mode: AssessmentInputMode
  fixtureFrames: PoseFrame[]
  capturedImages: Partial<Record<ViewLabel, CapturedViewImage>>
  liveFrames: PoseFrame[]
}

export function createInitialPoseFrameSourceState(): PoseFrameSourceState {
  return {
    mode: 'fixture',
    fixtureFrames: testLandmarksFrames,
    capturedImages: {},
    liveFrames: [],
  }
}

export function getAssessableFrames(state: PoseFrameSourceState): PoseFrame[] {
  return state.mode === 'fixture' ? state.fixtureFrames : state.liveFrames
}

export function hasRequiredCapturedViews(state: PoseFrameSourceState): boolean {
  return Boolean(state.capturedImages.front?.uri && state.capturedImages.side?.uri)
}
