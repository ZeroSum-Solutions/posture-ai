import type { PoseFrame } from '../types'
import * as testLandmarksJson from '../../fixtures/test-landmarks.json'

export interface TestLandmarksFixture {
  frames: PoseFrame[]
}

/** Committed front+side landmark frames for deterministic assessment tracing. */
export const testLandmarksFixture = testLandmarksJson as unknown as TestLandmarksFixture

/** Pose frames passed to {@link assessPosture} in mobile slice 1 and e2e fixtures. */
export const testLandmarksFrames: PoseFrame[] = testLandmarksFixture.frames
