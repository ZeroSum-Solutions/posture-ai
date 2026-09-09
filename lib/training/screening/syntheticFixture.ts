import { testLandmarksFrames, type PoseFrame } from '@posture-ai/engine'

/**
 * Expands the committed legacy front + side landmark fixture into the four
 * explicitly asserted capture groups required by ScreeningContextV1. This is
 * synthetic prototype/test data only: copied landmarks do not claim that the
 * camera view was independently verified, and missing image/model provenance
 * remains visible in the resulting screening context.
 */
export function syntheticScreeningFixtureFramesV1(): PoseFrame[] {
  const front = testLandmarksFrames.find((frame) => frame.view === 'front')
  const side = testLandmarksFrames.find((frame) => frame.view === 'side')
  if (!front || !side) throw new Error('Synthetic screening fixture is incomplete')

  return [
    { ...front, view: 'front' },
    { ...side, view: 'side', profileSide: 'left' },
    { ...side, view: 'side', profileSide: 'right' },
    { ...front, view: 'back' },
  ]
}
