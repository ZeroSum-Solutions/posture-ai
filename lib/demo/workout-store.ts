import { z } from 'zod'
import type { RunPatch, RatingPayload } from '@/app/workouts/_player/WorkoutPlayer'
import type { SessionSnapshot } from '@/lib/workout/generateWorkoutSession'
import { workoutPreferencesSchema } from './workout'

export const DEMO_WORKOUT_STORAGE_KEY = 'posture-ai:demo:workouts:v1'
const timing = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('hold'), sets: z.number().int().min(1).max(6), secondsPerSet: z.number().min(1).max(120), restSeconds: z.number().min(0).max(120) }),
  z.object({ kind: z.literal('reps'), sets: z.number().int().min(1).max(6), repsPerSet: z.number().int().min(1).max(30), restSeconds: z.number().min(0).max(120) }),
])
const localMediaPath = z.string().max(300).regex(/^\/(?!\/)[a-zA-Z0-9/_\-.]+$/)
const snapshotSchema = z.object({
  version: z.literal(1), disclaimer: z.string().max(600), week: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  capability: z.enum(['regression', 'standard', 'progression']), estimatedDurationSec: z.number().min(1).max(7200),
  priorities: z.array(z.object({ primaryKey: z.string().max(80), label: z.string().max(120), zone: z.enum(['warning', 'danger']), severityWord: z.string().max(30) })).max(3),
  items: z.array(z.object({ index: z.number().int().min(0).max(40), slug: z.string().max(90), baseSlug: z.string().max(90), name: z.string().max(120), category: z.enum(['stretch', 'strengthen', 'mobility', 'activation', 'informational']), stepLabel: z.string().max(60), priorityKey: z.string().max(80), priorityLabel: z.string().max(120), isIntegrative: z.boolean(), instructions: z.string().max(1200), timing,
    media: z.object({ loopUrl: localMediaPath, posterUrl: localMediaPath, fallbackGifUrl: localMediaPath.optional() }).optional(),
    form: z.object({ alignmentCue: z.string().max(300), avoidCue: z.string().max(300), tempo: z.string().max(100).optional() }).optional(), steps: z.array(z.string().max(300)).max(10).optional(),
  })).min(1).max(40),
})
const runSchema = z.object({ status: z.enum(['started', 'in_progress', 'paused', 'completed', 'abandoned']).optional(), current_item_index: z.number().int().min(0).max(40).optional(), items: z.array(z.object({ slug: z.string().max(90), completed: z.boolean(), skipped: z.boolean(), durationMs: z.number().min(0).optional() })).max(40).optional(), total_duration_ms: z.number().min(0).optional(), revision: z.number().int().min(0).optional(), red_flag_acknowledged: z.boolean().optional() })
const ratingSchema = z.object({ clarity: z.number().min(1).max(5).optional(), pace: z.enum(['too_slow', 'just_right', 'too_fast']).optional(), difficulty: z.enum(['too_easy', 'just_right', 'too_hard']).optional(), feedback_tags: z.array(z.string().max(80)).max(20), notes: z.string().max(1000).optional() })
const workoutSchema = z.object({ id: z.string().max(100), name: z.string().min(1).max(80), scanId: z.string().max(100), scanLabel: z.string().max(120), createdAt: z.string(), source: z.enum(['ai', 'scan']), summary: z.string().max(1000), preferences: workoutPreferencesSchema, snapshot: snapshotSchema, run: runSchema.optional(), rating: ratingSchema.optional() })
export type DemoWorkout = Omit<z.infer<typeof workoutSchema>, 'snapshot' | 'run' | 'rating'> & { snapshot: SessionSnapshot; run?: RunPatch; rating?: RatingPayload }
export function loadDemoWorkouts(): DemoWorkout[] {
  const raw = localStorage.getItem(DEMO_WORKOUT_STORAGE_KEY)
  if (!raw) return []
  const parsed = z.array(workoutSchema).max(40).safeParse(JSON.parse(raw))
  if (!parsed.success) throw new Error('Saved workouts could not be read. Reset the local library to start fresh.')
  return parsed.data as DemoWorkout[]
}
export function saveDemoWorkouts(workouts: DemoWorkout[]): void {
  const parsed = z.array(workoutSchema).max(40).safeParse(workouts)
  if (!parsed.success) throw new Error('This workout could not be saved. Check the plan and try again.')
  localStorage.setItem(DEMO_WORKOUT_STORAGE_KEY, JSON.stringify(parsed.data))
}
export function clearDemoWorkouts(): void { localStorage.removeItem(DEMO_WORKOUT_STORAGE_KEY) }
