import { z } from 'zod'
import { buildProgramFrom } from '@/lib/program/buildProgram'
import { generateWorkoutSession, type SessionItem, type SessionSnapshot } from '@/lib/workout/generateWorkoutSession'
import type { Finding } from '@/packages/posture-engine/src/types'

export const workoutPreferencesSchema = z.object({
  goal: z.enum(['balanced', 'desk-reset', 'mobility', 'strength']),
  minutes: z.union([z.literal(10), z.literal(15), z.literal(20)]),
  capability: z.enum(['regression', 'standard', 'progression']),
  equipment: z.array(z.enum(['band', 'roller'])).max(2),
}).strict()
export type WorkoutPreferences = z.infer<typeof workoutPreferencesSchema>
export const DEFAULT_WORKOUT_PREFERENCES: WorkoutPreferences = { goal: 'balanced', minutes: 15, capability: 'standard', equipment: [] }
export const WORKOUT_GOALS = { balanced: 'Everyday balance', 'desk-reset': 'Desk reset', mobility: 'Move more freely', strength: 'Build strength' } as const
export const demoFindingSchema = z.object({
  key: z.string().max(60), label: z.string().max(100), region: z.enum(['head_shoulders', 'spine', 'pelvis', 'leg']),
  deviation: z.number().finite().min(-360).max(360), standard: z.number().finite().min(-360).max(360), unit: z.string().max(12),
  direction: z.string().max(80), severityPct: z.number().min(0).max(100), zone: z.enum(['maintain', 'warning', 'danger', 'unreliable']),
  viewUsed: z.enum(['front', 'side', 'back']), confidence: z.number().min(0).max(1), reliable: z.boolean(),
  landmarksUsed: z.array(z.string().max(60)).max(40),
})
export const workoutRequestSchema = z.object({ findings: z.array(demoFindingSchema).min(1).max(20), preferences: workoutPreferencesSchema }).strict()

export function itemDuration(item: SessionItem): number {
  const t = item.timing
  return t.sets * (t.kind === 'hold' ? t.secondsPerSet : t.repsPerSet * 4) + Math.max(0, t.sets - 1) * t.restSeconds + 8
}
export function withWorkoutItems(snapshot: SessionSnapshot, items: SessionItem[]): SessionSnapshot {
  return { ...snapshot, priorities: snapshot.priorities.filter((priority) => items.some((item) => item.priorityKey === priority.primaryKey)), items: items.map((item, index) => ({ ...item, index })), estimatedDurationSec: items.reduce((sum, item) => sum + itemDuration(item), 0) }
}

// Authored equipment references are conservative: an unavailable prop excludes
// the movement. A wall, chair and floor space are baseline household supports.
export function equipmentAllowed(item: SessionItem, equipment: WorkoutPreferences['equipment']): boolean {
  const text = `${item.slug} ${item.name} ${item.instructions}`.toLowerCase()
  if (/\bband\b/.test(text) && !equipment.includes('band')) return false
  if (/\broller\b/.test(text) && !equipment.includes('roller')) return false
  if (/\b(dumbbell|kettlebell|barbell|cable machine|medicine ball|stability ball|lacrosse ball|massage ball|dowel)\b/.test(text)) return false
  return true
}

/** Full findings go through the original coherence/contraindication engine. */
export function workoutCandidates(findings: Finding[], preferences: WorkoutPreferences): SessionSnapshot | null {
  const report = buildProgramFrom(findings, 'C', { capability: preferences.capability })
  const snapshot = generateWorkoutSession(report, { week: 1 })
  if (!snapshot) return null
  const available = snapshot.items.filter((item) => equipmentAllowed(item, preferences.equipment))
  if (!available.length) return null
  return withWorkoutItems({ ...snapshot, version: 1, disclaimer: 'Prototype movement session based on screening findings. Stop if a movement causes pain. Screening support only — not a medical diagnosis.' }, available)
}

export function selectWorkoutItems(candidates: SessionSnapshot, preferences: WorkoutPreferences, aiSlugs?: string[]): SessionSnapshot {
  const allowed = new Set(candidates.items.map((item) => item.slug))
  if (aiSlugs && (!aiSlugs.length || new Set(aiSlugs).size !== aiSlugs.length || aiSlugs.some((slug) => !allowed.has(slug)))) {
    throw new Error('AI returned an exercise outside the available plan.')
  }
  const chosen = aiSlugs ? new Set(aiSlugs) : null
  const preferred = candidates.items.filter((item) => !chosen || chosen.has(item.slug))
  // Rank by goal to choose what fits, then restore the authored movement arc.
  const ranked = [...preferred].sort((a, b) => goalRank(a, preferences.goal) - goalRank(b, preferences.goal))
  const selected = new Set<string>()
  let seconds = 0
  for (const item of ranked) {
    const duration = itemDuration(item)
    if (seconds + duration > preferences.minutes * 60) continue
    selected.add(item.slug)
    seconds += duration
  }
  if (!selected.size) throw new Error('No exercises fit this time preference.')
  return withWorkoutItems(candidates, candidates.items.filter((item) => selected.has(item.slug)))
}
function goalRank(item: SessionItem, goal: WorkoutPreferences['goal']): number {
  if (goal === 'strength') return item.category === 'strengthen' || item.category === 'activation' ? 0 : 1
  if (goal === 'mobility') return item.category === 'mobility' || item.category === 'stretch' ? 0 : 1
  if (goal === 'desk-reset') return /head|shoulder/.test(item.priorityKey) ? 0 : 1
  return 0
}
export function workoutSummary(snapshot: SessionSnapshot): string {
  const focuses = [...new Set(snapshot.items.map((item) => item.priorityLabel))]
  return `${snapshot.items.length} movements for ${focuses.join(', ').toLowerCase()}. Follow the on-screen coaching at your own pace.`
}
