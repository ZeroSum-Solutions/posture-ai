import { z } from 'zod'
import type { SessionItem, SessionSnapshot } from './generateWorkoutSession'

export const workoutPreferencesSchema = z.object({
  goal: z.enum(['balanced', 'desk-reset', 'mobility', 'strength']),
  minutes: z.union([z.literal(10), z.literal(15), z.literal(20)]),
  capability: z.enum(['regression', 'standard', 'progression']),
  equipment: z.array(z.enum(['band', 'roller'])).max(2),
}).strict()

export type WorkoutPreferences = z.infer<typeof workoutPreferencesSchema>

export const DEFAULT_WORKOUT_PREFERENCES: WorkoutPreferences = {
  goal: 'balanced',
  minutes: 15,
  capability: 'standard',
  equipment: [],
}

export const WORKOUT_GOALS = {
  balanced: 'Everyday balance',
  'desk-reset': 'Desk reset',
  mobility: 'Move more freely',
  strength: 'Build strength',
} as const

export function workoutItemDuration(item: SessionItem): number {
  const timing = item.timing
  const workSeconds = timing.kind === 'hold'
    ? timing.sets * timing.secondsPerSet
    : timing.sets * timing.repsPerSet * 4
  return workSeconds + Math.max(0, timing.sets - 1) * timing.restSeconds + 8
}

function withItems(snapshot: SessionSnapshot, items: SessionItem[]): SessionSnapshot {
  return {
    ...snapshot,
    priorities: snapshot.priorities.filter((priority) => (
      items.some((item) => item.priorityKey === priority.primaryKey)
    )),
    items: items.map((item, index) => ({ ...item, index })),
    estimatedDurationSec: items.reduce((sum, item) => sum + workoutItemDuration(item), 0),
  }
}

function equipmentAllowed(item: SessionItem, equipment: WorkoutPreferences['equipment']): boolean {
  const text = `${item.slug} ${item.name} ${item.instructions}`.toLowerCase()
  if (/\bband\b/.test(text) && !equipment.includes('band')) return false
  if (/\broller\b/.test(text) && !equipment.includes('roller')) return false
  if (/\b(dumbbell|kettlebell|barbell|cable machine|medicine ball|stability ball|lacrosse ball|massage ball|dowel)\b/.test(text)) return false
  return true
}

function goalRank(item: SessionItem, goal: WorkoutPreferences['goal']): number {
  if (goal === 'strength') return item.category === 'strengthen' || item.category === 'activation' ? 0 : 1
  if (goal === 'mobility') return item.category === 'mobility' || item.category === 'stretch' ? 0 : 1
  if (goal === 'desk-reset') return /head|shoulder/.test(item.priorityKey) ? 0 : 1
  return 0
}

export function personalizeWorkout(
  candidates: SessionSnapshot,
  preferences: WorkoutPreferences,
  selectedSlugs?: string[],
): SessionSnapshot {
  const equipmentCandidates = candidates.items.filter((item) => (
    equipmentAllowed(item, preferences.equipment)
  ))
  const allowed = new Set(equipmentCandidates.map((item) => item.slug))
  if (
    selectedSlugs
    && (
      selectedSlugs.length === 0
      || new Set(selectedSlugs).size !== selectedSlugs.length
      || selectedSlugs.some((slug) => !allowed.has(slug))
    )
  ) {
    throw new Error('Selected workout contains an exercise outside the available plan.')
  }

  const chosen = selectedSlugs ? new Set(selectedSlugs) : null
  const eligible = equipmentCandidates.filter((item) => !chosen || chosen.has(item.slug))
  const ranked = [...eligible].sort((left, right) => (
    goalRank(left, preferences.goal) - goalRank(right, preferences.goal)
  ))
  const selected = new Set<string>()
  let seconds = 0
  for (const item of ranked) {
    const duration = workoutItemDuration(item)
    if (seconds + duration > preferences.minutes * 60) continue
    selected.add(item.slug)
    seconds += duration
  }
  if (selected.size === 0) throw new Error('No exercises fit these workout preferences.')

  return withItems(
    candidates,
    equipmentCandidates.filter((item) => selected.has(item.slug)),
  )
}

export function removeWorkoutItem(snapshot: SessionSnapshot, slug: string): SessionSnapshot {
  const remaining = snapshot.items.filter((item) => item.slug !== slug)
  if (remaining.length === 0 || remaining.length === snapshot.items.length) return snapshot
  return withItems(snapshot, remaining)
}

export function workoutSummary(snapshot: SessionSnapshot): string {
  const focuses = [...new Set(snapshot.items.map((item) => item.priorityLabel))]
  return `${snapshot.items.length} movements for ${focuses.join(', ').toLowerCase()}. Follow the on-screen coaching at your own pace.`
}
