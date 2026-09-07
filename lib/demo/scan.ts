import { z } from 'zod'
import { assessPosture, testLandmarksFrames, type AssessmentResult, type PoseFrame } from '@posture-ai/engine'
import { stripFaceLandmarks } from '@/lib/pose/face-min'

export interface DemoScan {
  version: 1
  id: string
  createdAt: string
  source: 'sample' | 'capture'
  label: string
  frames: PoseFrame[]
  result: AssessmentResult
}

const landmark = z.object({
  x: z.number().finite().min(-0.5).max(1.5),
  y: z.number().finite().min(-0.5).max(1.5),
  z: z.number().finite().optional(),
  visibility: z.number().min(0).max(1).optional(),
}).strict()

const frame = z.object({
  view: z.enum(['front', 'side', 'back']),
  landmarks: z.record(z.string().max(40), landmark),
  aspectRatio: z.number().finite().min(0.1).max(10).optional(),
  source: z.enum(['camera', 'upload']).optional(),
  captureRollDeg: z.number().finite().min(-45).max(45).optional(),
  profileSide: z.enum(['left', 'right']).optional(),
}).strict()

const framesSchema = z.array(frame).min(2).max(4).refine(
  frames => frames.some(frame => frame.view === 'front') && frames.some(frame => frame.view === 'side'),
  'Add a front view and a side view.',
)

const storedScanSchema = z.object({
  version: z.literal(1),
  id: z.string().min(1).max(100),
  createdAt: z.string().datetime(),
  source: z.enum(['sample', 'capture']),
  label: z.string().min(1).max(80),
  frames: framesSchema,
})

/** Local screening uses the same engine as the practitioner application. */
export function createDemoScan(frames: PoseFrame[], label = 'My posture scan'): DemoScan {
  const validated = framesSchema.parse(frames)
  const minimized = validated.map(frame => stripFaceLandmarks(frame))
  const createdAt = new Date().toISOString()
  return {
    version: 1,
    id: globalThis.crypto.randomUUID(),
    createdAt,
    source: 'capture',
    label: label.slice(0, 80) || 'My posture scan',
    frames: minimized,
    result: { ...assessPosture(minimized), generatedAt: createdAt },
  }
}

/** The same authored subject/coordinates on every run; never described as a live scan. */
export function createSampleScan(): DemoScan {
  const scan = createDemoScan(structuredClone(testLandmarksFrames), 'Alex · sample scan')
  return { ...scan, source: 'sample' }
}

/** Re-score validated coordinates instead of trusting stored scores or copy. */
export function parseDemoScan(value: unknown): DemoScan | null {
  const parsed = storedScanSchema.safeParse(value)
  if (!parsed.success) return null
  const frames = parsed.data.frames.map(frame => stripFaceLandmarks(frame))
  return {
    ...parsed.data,
    frames,
    result: { ...assessPosture(frames), generatedAt: parsed.data.createdAt },
  }
}
