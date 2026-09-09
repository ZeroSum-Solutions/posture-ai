import type { SessionSnapshot } from '@/lib/workout/generateWorkoutSession'
import type { WorkoutPreferences } from '@/lib/workout/personalize'

export type WorkoutLibraryItem = {
  id: string
  assessmentId: string
  clientId: string
  clientName: string
  name: string
  source: 'scan' | 'ai'
  preferences: WorkoutPreferences
  snapshot: SessionSnapshot
  createdAt: string
  playable: boolean
  run: { status: string; completedItems: number } | null
}

export type WorkoutBuilderSeed = {
  assessmentId: string
  clientId: string
  clientName: string
  capability: WorkoutPreferences['capability']
  approved: boolean
}

export function workoutLibraryKey(library: WorkoutLibraryItem[], seed?: WorkoutBuilderSeed | null): string {
  return `${seed?.assessmentId ?? 'library'}:${library.map((entry) => entry.id).join(',')}`
}
