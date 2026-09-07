import type { PoseFrame } from '@posture-ai/engine/types'
import type { FrameQuality } from '@/lib/pose/quality'
import type { Captures, CaptureSlotKey, ViewKey } from './types'
import { SLOT_LABEL } from './types'
import { buildFramePlan, stampFrame, toScoringFrame } from './framePlan'

export interface AnalysisProgress {
  completed: number
  total: number
  slot: CaptureSlotKey
}

interface AnalysisRuntime {
  detect: (url: string, view: ViewKey, source: 'camera' | 'upload') => Promise<PoseFrame & { detectedPoseCount?: number }>
}

function abortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new DOMException('Analysis cancelled', 'AbortError'))
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new DOMException('Analysis cancelled', 'AbortError'))
    signal.addEventListener('abort', onAbort, { once: true })
    operation.then(
      value => { signal.removeEventListener('abort', onAbort); resolve(value) },
      error => { signal.removeEventListener('abort', onAbort); reject(error) },
    )
  })
}

/**
 * Convert the four committed capture slots to the landmark-only API payload.
 * The first camera-burst frame reuses its completed preflight detection; every
 * other frame remains independently detected for within-capture stability.
 */
export async function analyzeCaptureFrames(input: {
  captures: Captures
  runtime: AnalysisRuntime
  assessFrameQuality: (frame: PoseFrame, view: ViewKey) => FrameQuality
  signal: AbortSignal
  onProgress: (progress: AnalysisProgress) => void
}): Promise<PoseFrame[]> {
  const plan = buildFramePlan(input.captures)
  const total = plan.reduce((count, item) => count + (item.burstUrls?.length ?? 1), 0)
  const frames: PoseFrame[] = []
  let completed = 0

  for (const item of plan) {
    const reportProgress = () => input.onProgress({ completed: ++completed, total, slot: item.slot })
    if (item.burstUrls) {
      const cachedRepresentative = input.captures[item.slot].rawPoseFrame
      for (let index = 0; index < item.burstUrls.length; index += 1) {
        if (input.signal.aborted) throw new DOMException('Analysis cancelled', 'AbortError')
        if (index === 0 && cachedRepresentative) {
          frames.push(stampFrame(cachedRepresentative, item.profileSide, item.roll))
          reportProgress()
          continue
        }
        const detected = await abortable(
          input.runtime.detect(item.burstUrls[index], item.view, 'camera'),
          input.signal,
        )
        const quality = input.assessFrameQuality(detected, item.view)
        if (quality.status === 'no_person' || quality.status === 'multiple_people') {
          throw new Error(`${SLOT_LABEL[item.slot]} must show exactly one person. Retake that view.`)
        }
        frames.push(stampFrame(detected, item.profileSide, item.roll))
        reportProgress()
      }
    } else if (item.cachedFrame) {
      frames.push(toScoringFrame(item.cachedFrame))
      reportProgress()
    } else if (item.fallbackUrl && item.source) {
      const detected = await abortable(
        input.runtime.detect(item.fallbackUrl, item.view, item.source),
        input.signal,
      )
      const quality = input.assessFrameQuality(detected, item.view)
      if (quality.status === 'no_person' || quality.status === 'multiple_people') {
        throw new Error(`${SLOT_LABEL[item.slot]} must show exactly one person. Retake that view.`)
      }
      frames.push(stampFrame(detected, item.profileSide, item.roll))
      reportProgress()
    }
  }

  return frames
}
